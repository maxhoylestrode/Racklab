import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { AppContext } from './context';
import { errorHandler, notFound } from './errors';
import { csrfProtect, loadSession, requireAuth } from './middleware/session';
import { authRoutes } from './routes/auth';

export type RouteModule = (ctx: AppContext) => Router;

/**
 * Builds the Express app. `protectedRoutes` are mounted under /api behind requireAuth + CSRF.
 * Later phases register their routers here.
 */
export function createApp(ctx: AppContext, protectedRoutes: RouteModule[] = []) {
  const app = express();
  app.disable('x-powered-by');
  // Behind Nginx Proxy Manager (and CapRover's nginx): trust the proxy chain for req.ip.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(cookieParser(ctx.config.sessionSecret));

  const api = Router();
  api.use(express.json({ limit: '25mb' }));
  api.use(loadSession(ctx));
  api.use(csrfProtect);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(authRoutes(ctx));
  const guarded = Router();
  guarded.use(requireAuth);
  for (const mod of protectedRoutes) guarded.use(mod(ctx));
  api.use(guarded);
  api.use((_req, _res, next) => next(notFound()));
  api.use(errorHandler);
  app.use('/api', api);

  // Serve the built SPA (production). Unknown non-API paths fall back to index.html.
  const webDist = ctx.config.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
