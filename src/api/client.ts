/**
 * Base API client — all requests go through here.
 * - Adds credentials (session cookie) automatically
 * - Throws APIError with status + message on non-2xx
 * - In dev/web, requests are proxied by Vite to localhost:3001
 * - In the Tauri desktop app, VITE_API_URL must be set to the production
 *   server URL (e.g. https://your-server.onrender.com) because there is no
 *   Vite proxy at runtime.
 */

export class APIError extends Error {
  /**
   * The error response's JSON body, when it was JSON.
   *
   * Some errors carry more than a sentence. A refused collaborative save
   * returns the note as it is now, so the person can see what they would
   * have overwritten. Dropping the body turned those into a bare message.
   */
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown = undefined,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // In the Tauri desktop build there is no Vite proxy, so all API calls
  // must go to the absolute production server URL.  VITE_API_URL is set
  // at build time via the .env file; in the web build it is left empty and
  // relative paths work as before.
  const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const url  = base ? `${base}${path}` : path;

  const res = await fetch(url, {
    ...options,
    credentials: 'include', // send session cookie
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    let body: unknown;
    try {
      body = await res.json();
      const errVal = (body as any)?.error ?? (body as any)?.message;
      if (typeof errVal === 'string') {
        message = errVal;
      } else if (errVal && typeof errVal === 'object') {
        // Zod validation errors come back as { issues: [{ message, ... }] } —
        // surface the human-readable issues instead of "[object Object]".
        const issues = (errVal as any).issues;
        if (Array.isArray(issues) && issues.length) {
          message = issues.map((i: any) => i.message ?? JSON.stringify(i)).join('; ');
        } else if (typeof (errVal as any).message === 'string') {
          message = (errVal as any).message;
        }
      }
    } catch {}
    throw new APIError(res.status, message, body);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string) {
  return apiFetch<T>(path);
}

export function apiPost<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, {
    method: 'POST',
    body:   body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPut<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, {
    method: 'PUT',
    body:   body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body:   body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, {
    method: 'DELETE',
    body:   body !== undefined ? JSON.stringify(body) : undefined,
  });
}