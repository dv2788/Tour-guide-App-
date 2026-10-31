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
  /^(www\.)?google\.[a-z.]+$/,
  /^maps\.google\.[a-z.]+$/,
  /^consent\.google\.com$/,
  /^maps\.apple\.com$/,
];
const MAX_HOPS = 6;

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
    const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 TourGuide link resolver' } });
    const location = res.headers.get('Location');
    if (res.status < 300 || res.status >= 400 || !location) break;
    current = new URL(location, current).toString();
  }
  return current;
}

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });
  if (!isAllowed(target)) return json({ error: 'Not a supported map link' }, 400);
  try {
    return json({ url: await resolve(target) });
  } catch {
    return json({ error: 'Could not expand this link' }, 502);
  }
}
