import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, code = 'bad_request', details?: unknown) => new HttpError(400, msg, code, details);
export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');
export const conflict = (msg: string, code = 'conflict', details?: unknown) => new HttpError(409, msg, code, details);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', 'validation', r.error.flatten());
  return r.data;
}

/** Wrap async route handlers so rejections reach the error handler. */
export const ah = (fn: (...a: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'validation', message: 'Validation failed', details: err.flatten() } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Request body too large' } });
    return;
  }
  // Postgres constraint violations surface as 409s with a generic message (never echo values).
  const pgCode = err?.code ?? err?.cause?.code;
  if (pgCode === '23505') { res.status(409).json({ error: { code: 'duplicate', message: 'That value is already in use' } }); return; }
  if (pgCode === '23503') { res.status(409).json({ error: { code: 'in_use', message: 'Referenced record is missing or still in use' } }); return; }
  if (pgCode === '23514') { res.status(400).json({ error: { code: 'constraint', message: 'A value is outside the allowed range' } }); return; }
  if (pgCode === '22P02') { res.status(400).json({ error: { code: 'invalid_value', message: 'A value has the wrong format' } }); return; }
  console.error('Unhandled error:', err?.message ?? err);
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
};
