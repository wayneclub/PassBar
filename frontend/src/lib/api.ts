const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
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
let lastResumeRefreshAt = 0;

export function isSessionInvalid() {
  return sessionInvalid;
}

function clearClientLoginMarker() {
  if (typeof document === 'undefined') return;
  document.cookie = 'pb_logged_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = 'pb_logged_in=; path=/; domain=.wayneclub.com; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

function hasLoggedInCookie() {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((cookie) => cookie.trim().startsWith('pb_logged_in='));
}

function markSessionInvalid() {
  if (sessionInvalid) return;
  sessionInvalid = true;
  clearClientLoginMarker();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('passbar-session-expired'));
  }
}

async function revokeAuthSession() {
  // access_token and refresh_token are HttpOnly cookies owned by auth.wayneclub.com.
  // Only that service can reliably remove them; JavaScript can only remove our
  // non-sensitive pb_logged_in marker.
  await fetch(authServiceUrl('/auth/signout'), {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
  }).catch(() => undefined);
}

function redirectToSignIn(preserveCurrentPath: boolean) {
  if (typeof window === 'undefined' || window.location.pathname.startsWith('/auth') || window.location.pathname.startsWith('/privacy')) return;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const destination = preserveCurrentPath
    ? `/auth?next=${encodeURIComponent(currentPath)}`
    : '/auth';
  window.location.replace(destination);
}

/**
 * Ends an expired session once, clears the client marker, asks auth-service to
 * remove its HttpOnly cookies, and sends the user back to sign-in immediately.
 */
function expireSession() {
  if (sessionInvalid) return;
  markSessionInvalid();
  void revokeAuthSession();
  redirectToSignIn(true);
}

/** Explicit user sign-out. Unlike an expiry redirect, it waits for revocation first. */
export async function signOutSession() {
  markSessionInvalid();
  await revokeAuthSession();
  redirectToSignIn(false);
}

/** access_token cookies are short-lived (15min); refresh_token (30d) lets auth-service mint a new one. */
function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(authServiceUrl('/auth/refresh'), { method: 'POST', credentials: 'include' })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          expireSession();
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

/**
 * 主動換發 access token（App 啟動時用）。access token 只有 15 分鐘壽命，
 * 閒置後回來的第一個請求必然 401 再靠重試恢復——先 refresh 可避免 console 噪音。
 */
export function ensureFreshAccessToken(): Promise<boolean> {
  return refreshAccessToken();
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  if (sessionInvalid) {
    throw new ApiError(401, 'Session expired');
  }

  // A visibility/focus event starts a refresh synchronously. Let requests that
  // resume at the same time wait for it, so the first API call is not a noisy 401.
  if (refreshPromise) await refreshPromise;
  if (sessionInvalid) throw new ApiError(401, 'Session expired');

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

  // A backend 401 after a failed refresh means neither token can establish a
  // session. Treat it as sign-out rather than leaving stale cookies and pollers.
  if (res.status === 401 && !sessionInvalid) expireSession();

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

// Refresh before a backgrounded page resumes.  The 60-second guard collapses
// the visibilitychange, focus, and pageshow events that browsers often emit together.
function refreshAfterResume() {
  if (sessionInvalid || !hasLoggedInCookie() || Date.now() - lastResumeRefreshAt < 60_000) return;
  lastResumeRefreshAt = Date.now();
  void refreshAccessToken();
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', refreshAfterResume);
  window.addEventListener('pageshow', refreshAfterResume);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAfterResume();
  });
}
