/** Absolute URL prefix for browser navigations (OIDC redirect) — same rules as axios baseURL. */
export function apiAuthUrl(path: string): string {
  const b = import.meta.env.VITE_API_URL || '/api';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (b.startsWith('http')) {
    return `${b.replace(/\/$/, '')}${p}`;
  }
  return `${window.location.origin}${b.replace(/\/$/, '')}${p}`;
}
