const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const AUTH_SERVICE_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? 'http://localhost:4010';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorMessageFrom(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (Array.isArray(message)) return message.map(String).join(', ');
    if (message !== undefined && message !== null) return String(message);
  }
  return fallback;
}

let refreshPromise: Promise<boolean> | null = null;

/** Set once the refresh token itself is rejected, so pollers can stop hammering a dead session instead of retrying every tick until the redirect navigation lands. */
let sessionInvalid = false;

export function isSessionInvalid() {
  return sessionInvalid;
}

function deleteLoggedInCookie() {
  sessionInvalid = true;
  if (typeof document === 'undefined') return;
  document.cookie = 'pb_logged_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = 'pb_logged_in=; path=/; domain=.wayneclub.com; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth') && !window.location.pathname.startsWith('/privacy')) {
    window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
  }
}

/** access_token cookies are short-lived (15min); refresh_token (30d) lets auth-service mint a new one. */
function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(authServiceUrl('/auth/refresh'), { method: 'POST', credentials: 'include' })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          deleteLoggedInCookie();
          return false;
        }
        if (!res.ok) {
          return false;
        }
        return true;
      })
      .catch(() => {
        return false;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  if (sessionInvalid) {
    throw new ApiError(401, 'Session expired');
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried && (await refreshAccessToken())) {
    return request<T>(path, options, true);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const fallback = res.statusText || `Request failed with status ${res.status}`;
    throw new ApiError(res.status, errorMessageFrom(data, fallback));
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
