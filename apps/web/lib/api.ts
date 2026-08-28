import type { Problem } from '@teranga/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

/** Client API unique : cookies de session inclus, erreurs RFC 9457 typées. */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal: options.signal,
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let problem: Problem;
    try {
      problem = (await res.json()) as Problem;
    } catch {
      problem = { type: 'about:blank', title: `Erreur ${res.status}`, status: res.status };
    }
    throw new ApiError(problem);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.problem.status === 401;
}

/** URL absolue d'une route API — pour les téléchargements directs (PDF…). */
export function apiUrl(path: string): string {
  return `${API_BASE}/v1${path}`;
}
