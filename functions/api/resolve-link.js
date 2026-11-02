// Expands short map links (maps.app.goo.gl, maps.apple/…) into the full link the app can
// read. Browsers can't do this themselves: the redirect target is hidden from web pages.
//
// This is a Cloudflare Pages Function: when the app is hosted on Cloudflare Pages it is
// served at /api/resolve-link automatically. Elsewhere (e.g. GitHub Pages) it simply
// doesn't exist and the app explains how to paste a full link instead.
//
// Only known map-link hosts are followed, so this can't be used as an open proxy.

const ALLOWED = [
  /^maps\.app\.goo\.gl$/,
  /^goo\.gl$/,
  /^g\.co$/,
  /^maps\.apple$/,
  /^share\.here\.com$/,
  // Google's own country domains only (google.com, google.de, google.co.uk, google.com.br):
  // "google." followed by anything would let google.evil.example in.
  /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/,
  /^consent\.google\.com$/,
  /^maps\.apple\.com$/,
];
const MAX_HOPS = 6;
const HOP_TIMEOUT_MS = 4000; // a slow server can't hold the function open

export function isAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Follow redirects (without downloading pages) until we reach a full map link. */
export async function resolve(url, fetchImpl = fetch) {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isAllowed(current)) break;
    const res = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 TourGuide link resolver' },
      signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
    });
    const location = res.headers.get('Location');
    res.body?.cancel?.().catch?.(() => {}); // only the redirect matters, never the page
    if (res.status < 300 || res.status >= 400 || !location) break;
    current = new URL(location, current).toString();
  }
  return current;
}

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  // A good answer can be remembered for a day; a failure shouldn't be.
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=86400' : 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  if (!isAllowed(target)) return json({ error: 'Not a supported map link' }, 400);
  try {
    return json({ url: await resolve(target) });
  } catch {
    return json({ error: 'Could not expand this link' }, 502);
  }
}
