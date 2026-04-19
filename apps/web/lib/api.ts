/**
 * Tiny fetch wrapper that talks to the Hono API at NEXT_PUBLIC_API_URL.
 *
 *   - Always sends `credentials: 'include'` so the httpOnly refresh cookie
 *     (scoped to /api/auth) rides along on /refresh and /logout calls.
 *   - Adds an Authorization: Bearer header when an access token is supplied.
 *   - Throws a typed `ApiError` on non-2xx responses so the caller can show
 *     friendly messages without re-parsing the JSON envelope.
 *
 * The API speaks the envelope `{ error: { code, message, field? } }` on
 * failure (see apps/api/src/middleware/errors.ts) — we surface `code` so
 * UI code can branch on `ErrorCode.Conflict` etc. without string-matching.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export interface ApiErrorPayload {
  code: string;
  message: string;
  field?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.field = payload.field;
  }
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  accessToken?: string | null;
  signal?: AbortSignal;
}

export async function api<T>({
  method = 'GET',
  path,
  body,
  accessToken,
  signal,
}: ApiRequest): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // 204 No Content — return undefined as T (the caller knows the shape).
  if (res.status === 204) return undefined as unknown as T;

  // Parse JSON defensively — a misbehaving server might return HTML.
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, {
        code: 'INTERNAL_ERROR',
        message: `Unexpected non-JSON response (${res.status})`,
      });
    }
  }

  if (!res.ok) {
    const envelope = parsed as { error?: ApiErrorPayload } | null;
    const errPayload = envelope?.error ?? {
      code: 'INTERNAL_ERROR',
      message: `Request failed with status ${res.status}`,
    };
    throw new ApiError(res.status, errPayload);
  }

  return parsed as T;
}
