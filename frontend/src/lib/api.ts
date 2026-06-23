const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const AUTH_SERVICE_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? 'http://localhost:4010';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = (data && (data.message?.toString?.() ?? data.message)) || res.statusText;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message);
  }

  return data as T;
}

function withBody(method: string) {
  return <T>(path: string, body?: unknown) =>
    request<T>(path, { method, body: body !== undefined ? JSON.stringify(body) : undefined });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: withBody('POST'),
  patch: withBody('PATCH'),
  put: withBody('PUT'),
  delete: withBody('DELETE'),
};

/** Builds a full backend URL, for cases like full-page redirects (e.g. OAuth) that can't go through fetch. */
export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

/** Builds a full auth-service (auth.wayneclub.com) URL — login/signout live there now, not on the PassBar backend. */
export function authServiceUrl(path: string) {
  return `${AUTH_SERVICE_URL}${path}`;
}
