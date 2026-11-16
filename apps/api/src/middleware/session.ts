import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context';
import type { SessionRow } from '../services/auth';
import { HttpError } from '../errors';

export const SESSION_COOKIE = 'rm_session';
export const CSRF_COOKIE = 'rm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionRow;
  }
}

export function setSessionCookies(ctx: AppContext, res: Response, token: string, session: SessionRow) {
  const maxAge = session.absolute_expires_at.getTime() - ctx.clock.now();
  const base = { secure: ctx.config.cookieSecure, sameSite: 'strict' as const, path: '/', maxAge };
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true, signed: true });
  // Double-submit CSRF token: readable by the SPA, echoed back in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE, session.csrf_token, { ...base, httpOnly: false });
}

export function clearSessionCookies(ctx: AppContext, res: Response) {
  const base = { secure: ctx.config.cookieSecure, sameSite: 'strict' as const, path: '/' };
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true, signed: true });
  res.clearCookie(CSRF_COOKIE, base);
}

/** Loads the session (if any) from the signed cookie and slides its expiry. */
export function loadSession(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    const token = req.signedCookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) return next();
    ctx.sessions
      .touch(token)
      .then((s) => {
        if (s) req.session = s;
        else clearSessionCookies(ctx, res);
        next();
      })
      .catch(next);
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session) return next(new HttpError(401, 'Not signed in', 'unauthenticated'));
  next();
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const eqConst = (a: string, b: string) => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/** Double-submit CSRF check on every state-changing request that carries a session. */
export const csrfProtect: RequestHandler = (req: Request, _res, next) => {
  if (SAFE.has(req.method) || !req.session) return next();
  const header = req.get(CSRF_HEADER) ?? '';
  const cookie = req.cookies?.[CSRF_COOKIE] ?? '';
  if (!header || !cookie || !eqConst(header, cookie) || !eqConst(header, req.session.csrf_token)) {
    return next(new HttpError(403, 'CSRF token missing or invalid', 'csrf'));
  }
  next();
};
