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
  const res = await onRequestGet({ request: new Request('https://app.example/api/resolve-link?url=https%3A%2F%2Fevil.example%2F') });
  assert.equal(res.status, 400);
  // A redirect to a non-map host is not followed.
  const stop = await resolve('https://maps.app.goo.gl/AbC123', async () => ({ status: 302, headers: new Headers({ Location: 'https://evil.example/' }) }));
  assert.equal(stop, 'https://evil.example/');
});
