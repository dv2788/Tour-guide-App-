import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, isAllowed, onRequestGet } from '../functions/api/resolve-link.js';

const redirects = {
  'https://maps.app.goo.gl/AbC123': 'https://www.google.com/maps/dir/Eiffel+Tower/Louvre/@48.86,2.31,14z',
  'https://maps.apple/p/xyz': '/directions-redirect', // relative redirect
};
const fakeFetch = async (url) => {
  if (url === 'https://maps.apple/directions-redirect') {
    return { status: 301, headers: new Headers({ Location: 'https://maps.apple.com/directions?destination=Louvre&mode=walking' }) };
  }
  const to = redirects[url];
  return to ? { status: 302, headers: new Headers({ Location: to }) } : { status: 200, headers: new Headers() };
};

test('follows short-link redirects to the full map link', async () => {
  assert.equal(await resolve('https://maps.app.goo.gl/AbC123', fakeFetch), 'https://www.google.com/maps/dir/Eiffel+Tower/Louvre/@48.86,2.31,14z');
  assert.equal(await resolve('https://maps.apple/p/xyz', fakeFetch), 'https://maps.apple.com/directions?destination=Louvre&mode=walking');
});

test('refuses anything that is not a map link (no open proxy)', async () => {
  assert.ok(!isAllowed('https://evil.example/x'));
  assert.ok(!isAllowed('http://maps.app.goo.gl/x'), 'https only');
  assert.ok(!isAllowed('https://maps.app.goo.gl.evil.example/x'));
  // Domains that only start like Google's.
  for (const host of ['google.evil.com', 'google.com.evil.net', 'maps.google.co.evil.io', 'www.google.evil', 'google.']) {
    assert.ok(!isAllowed(`https://${host}/maps`), host);
  }
  for (const host of ['www.google.com', 'google.de', 'www.google.co.uk', 'maps.google.com.br', 'consent.google.com']) {
    assert.ok(isAllowed(`https://${host}/maps`), host);
  }
  const res = await onRequestGet({ request: new Request('https://app.example/api/resolve-link?url=https%3A%2F%2Fevil.example%2F') });
  assert.equal(res.status, 400);
  // A redirect to a non-map host is not followed.
  const stop = await resolve('https://maps.app.goo.gl/AbC123', async () => ({ status: 302, headers: new Headers({ Location: 'https://evil.example/' }) }));
  assert.equal(stop, 'https://evil.example/');
});

test('a failure is not remembered for a day, and each step has a time limit', async () => {
  const res = await onRequestGet({ request: new Request('https://app.example/api/resolve-link?url=https%3A%2F%2Fevil.example%2F') });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  let signal = null;
  await resolve('https://maps.app.goo.gl/AbC123', async (url, opts) => {
    signal = opts.signal;
    return { status: 200, headers: new Headers() };
  });
  assert.ok(signal instanceof AbortSignal, 'every request can be cut off');
});

test('attack addresses are refused: credentials, ports, look-alikes, other schemes', async () => {
  for (const url of [
    'https://evil.example@maps.app.goo.gl/x', // "user" part
    'https://maps.app.goo.gl:8443/x', // another port
    'https://maps.app.goo.gl./x', // trailing dot
    'https://maps.app.goo.gl%2F@evil.example/x',
    'https://xn--mps-app-goo-gl-0nb.example/x', // punycode look-alike
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://2130706433/x', // 127.0.0.1 as a number
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://maps.app.goo.gl/x',
    '',
  ]) {
    assert.ok(!isAllowed(url), url);
  }
  assert.ok(isAllowed('https://MAPS.APP.GOO.GL/AbC'), 'host case does not matter');
  // Line breaks are dropped by the address parser: this still only ever reaches Google.
  assert.equal(new URL(' https://maps.app.goo.gl/x\nhttps://evil.example/').hostname, 'maps.app.goo.gl');
});

test('only a web address is ever handed back, wherever the redirects lead', async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const location of ['javascript:alert(document.domain)', 'data:text/html,hi', 'vbscript:x']) {
      globalThis.fetch = async () => ({ status: 302, headers: new Headers({ Location: location }) });
      const res = await onRequestGet({ request: new Request('https://app.example/api/resolve-link?url=https%3A%2F%2Fmaps.app.goo.gl%2FAbC') });
      assert.equal(res.status, 422, location);
      assert.equal(res.headers.get('Cache-Control'), 'no-store');
    }
    // Quotes in an address come back encoded, as plain text.
    globalThis.fetch = async () => ({ status: 302, headers: new Headers({ Location: 'https://ok.example/" onmouseover="x' }) });
    const quoted = await onRequestGet({ request: new Request('https://app.example/api/resolve-link?url=https%3A%2F%2Fmaps.app.goo.gl%2FAbC') });
    assert.equal((await quoted.json()).url, 'https://ok.example/%22%20onmouseover=%22x');
    // A normal answer still works.
    globalThis.fetch = async (url) => (url.includes('goo.gl') ? { status: 302, headers: new Headers({ Location: 'https://www.google.com/maps/place/Louvre/@48.86,2.33,17z' }) } : { status: 200, headers: new Headers() });
    const ok = await onRequestGet({ request: new Request('https://app.example/api/resolve-link?url=https%3A%2F%2Fmaps.app.goo.gl%2FAbC') });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).url, 'https://www.google.com/maps/place/Louvre/@48.86,2.33,17z');
  } finally {
    globalThis.fetch = realFetch;
  }
});
