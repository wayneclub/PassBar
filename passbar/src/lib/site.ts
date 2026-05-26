export const siteBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function withBasePath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${siteBasePath}${normalized}`;
}

export function absoluteAppUrl(path = '/') {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${withBasePath(path)}`;
}
