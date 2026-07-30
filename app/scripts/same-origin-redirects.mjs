/** Follow a bounded redirect chain without ever leaving the trusted origin. */
export async function fetchWithSameOriginRedirects({
  url,
  origin,
  fetchImpl = fetch,
  maxRedirects = 5,
  init = {},
}) {
  const allowedOrigin = new URL(origin).origin;
  const normalize = (raw) => {
    const value = new URL(raw);
    if (!['http:', 'https:'].includes(value.protocol)) {
      throw new Error(`unsupported URL protocol: ${value.protocol}`);
    }
    if (value.origin !== allowedOrigin) {
      throw new Error(`cross-origin request denied: ${value.origin}`);
    }
    value.hash = '';
    return value;
  };

  let current = normalize(url);
  const redirects = [];
  while (true) {
    const response = await fetchImpl(current, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) {
      return { response, url: current, redirects };
    }
    if (redirects.length >= maxRedirects) {
      throw new Error(`redirect limit exceeded: ${maxRedirects}`);
    }
    const location = response.headers.get('location');
    if (!location) throw new Error(`redirect missing Location: HTTP ${response.status}`);
    const next = normalize(new URL(location, current).href);
    redirects.push({ from: current.href, to: next.href, status: response.status });
    current = next;
  }
}
