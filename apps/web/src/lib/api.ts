/** Typed fetch wrapper: same-origin cookies, JSON, and the double-submit CSRF header. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)rm_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

type Listener = (e: ApiError) => void;
const unauthListeners = new Set<Listener>();
/** Called on any 401 so the app can drop back to the login screen. */
export function onUnauthenticated(fn: Listener) {
  unauthListeners.add(fn);
  return () => {
    unauthListeners.delete(fn);
  };
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (data as any)?.error ?? {};
    const e = new ApiError(res.status, err.code ?? 'error', err.message ?? res.statusText, err.details);
    if (res.status === 401 && e.code === 'unauthenticated') unauthListeners.forEach((fn) => fn(e));
    throw e;
  }
  return data as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T = { ok: true }>(url: string) => request<T>('DELETE', url),
};

/** A short human message for an error, including Zod field errors. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const fe = (e.details as any)?.fieldErrors as Record<string, string[]> | undefined;
    if (fe) {
      const first = Object.entries(fe).find(([, v]) => v?.length);
      if (first) return `${first[0].replace(/_/g, ' ')}: ${first[1][0]}`;
    }
    const fo = (e.details as any)?.formErrors as string[] | undefined;
    if (fo?.length) return fo[0];
    const errs = (e.details as any)?.errors as string[] | undefined;
    if (errs?.length) return `${e.message}: ${errs.slice(0, 3).join('; ')}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
