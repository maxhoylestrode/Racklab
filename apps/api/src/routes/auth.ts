import { Router } from 'express';
import { setupSchema, loginSchema, changeAppPasswordSchema } from '@rackmap/shared';
import type { AppContext } from '../context';
import { ah, parse, HttpError, notFound } from '../errors';
import { appUser } from '../db/schema';
import { hashPassword, verifyPassword, userExists } from '../services/auth';
import { audit } from '../services/audit';
import { clearSessionCookies, requireAuth, setSessionCookies } from '../middleware/session';

export function authRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  r.get('/auth/status', ah(async (_req, res) => {
    res.json({ setup_required: !(await userExists(db)) });
  }));

  // One-time setup. Once a user exists this route is a 404 forever.
  r.post('/auth/setup', ah(async (req, res) => {
    if (await userExists(db)) throw notFound();
    const { password } = parse(setupSchema, req.body);
    const password_hash = await hashPassword(password);
    const inserted = await db.insert(appUser).values({ id: 1, password_hash }).onConflictDoNothing().returning({ id: appUser.id });
    if (inserted.length === 0) throw notFound();
    await audit(db, 'auth.setup', 'app_user', '1', 'App password set');
    const { token, session } = await ctx.sessions.create();
    setSessionCookies(ctx, res, token, session);
    res.status(201).json({ ok: true, csrf_token: session.csrf_token });
  }));

  r.post('/auth/login', ah(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    const wait = await ctx.limiter.check(ip);
    if (wait > 0) {
      res.setHeader('Retry-After', Math.ceil(wait / 1000).toString());
      throw new HttpError(429, 'Too many attempts. Try again later.', 'rate_limited', { retry_after_s: Math.ceil(wait / 1000) });
    }
    const { password } = parse(loginSchema, req.body);
    const [user] = await db.select().from(appUser).limit(1);
    const ok = user ? await verifyPassword(user.password_hash, password) : false;
    if (!ok) {
      await ctx.limiter.fail(ip);
      await audit(db, 'auth.login_failed', 'app_user', null, `Failed login from ${ip}`);
      throw new HttpError(401, 'Incorrect password', 'bad_credentials');
    }
    await ctx.limiter.succeed(ip);
    const { token, session } = await ctx.sessions.create();
    setSessionCookies(ctx, res, token, session);
    await audit(db, 'auth.login', 'app_user', '1', `Login from ${ip}`);
    res.json({ ok: true, csrf_token: session.csrf_token });
  }));

  r.post('/auth/logout', requireAuth, ah(async (req, res) => {
    const sid = req.session!.id;
    await ctx.sessions.destroy(sid);
    for (const fn of ctx.onSessionEnd) fn(sid);
    clearSessionCookies(ctx, res);
    await audit(db, 'auth.logout', 'app_user', '1');
    res.json({ ok: true });
  }));

  r.get('/auth/me', requireAuth, ah(async (req, res) => {
    res.json({ authenticated: true, csrf_token: req.session!.csrf_token, expires_at: req.session!.expires_at });
  }));

  r.post('/auth/change-password', requireAuth, ah(async (req, res) => {
    const { current_password, new_password } = parse(changeAppPasswordSchema, req.body);
    const [user] = await db.select().from(appUser).limit(1);
    if (!user || !(await verifyPassword(user.password_hash, current_password))) {
      throw new HttpError(401, 'Current password is incorrect', 'bad_credentials');
    }
    await db.update(appUser).set({ password_hash: await hashPassword(new_password) });
    await audit(db, 'auth.password_changed', 'app_user', '1');
    res.json({ ok: true });
  }));

  return r;
}
