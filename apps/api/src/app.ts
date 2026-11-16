import express from 'express';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}
