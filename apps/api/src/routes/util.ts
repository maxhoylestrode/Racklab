import type { Request } from 'express';
import { uuid } from '@rackmap/shared';
import { notFound } from '../errors';

/** Reads and validates a :param as a UUID (invalid ids are a 404, not a 500). */
export function idParam(req: Request, name = 'id'): string {
  const v = req.params[name];
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
}

export function one<T>(rows: T[], what = 'Not found'): T {
  const r = rows[0];
  if (!r) throw notFound(what);
  return r;
}

/** Strips keys whose value is undefined so PATCH only touches supplied fields. */
export function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const q = (req: Request, key: string): string | undefined => {
  const v = req.query[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};
