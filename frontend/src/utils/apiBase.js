const DEFAULT_API_URL = "http://localhost:8080";

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveApiBase() {
  const configured = String(
    import.meta.env.VITE_API_URL
    || import.meta.env.VITE_PROXY_BASE_URL
    || DEFAULT_API_URL,
  ).trim();
  return trimTrailingSlash(configured || DEFAULT_API_URL);
}

export function buildApiUrl(path = "") {
  const base = resolveApiBase();
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
