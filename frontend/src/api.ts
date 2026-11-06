const configuredApiUrl = import.meta.env.VITE_API_BASE_URL?.trim() || import.meta.env.VITE_API_URL?.trim();

const isLoopbackHost = (hostname: string) => ['localhost', '127.0.0.1', '::1'].includes(hostname);
const resolvedApiUrl = !isLoopbackHost(window.location.hostname)
  ? new URL('/api', window.location.origin)
  : configuredApiUrl
    ? new URL(configuredApiUrl, window.location.origin)
    : new URL(`http://${window.location.hostname}:8000/api`);

if (isLoopbackHost(resolvedApiUrl.hostname) && !isLoopbackHost(window.location.hostname)) {
  resolvedApiUrl.hostname = window.location.hostname;
}

export const API_BASE_URL = resolvedApiUrl.toString().replace(/\/+$/, '');
