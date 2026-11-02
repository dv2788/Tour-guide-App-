import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVED_TO, movedUrl } from '../js/moved.js';

const at = (url) => {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash };
};

test('nothing moves until a new address is set (by scripts/move-site.mjs)', () => {
  assert.ok(MOVED_TO === '' || /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/$/.test(MOVED_TO), `MOVED_TO is empty or a plain https address (${MOVED_TO})`);
  if (!MOVED_TO) assert.equal(movedUrl(at('https://dv2788.github.io/Tour-guide-App-/?tour=paris')), null);
});

test('after the move, the same page opens at the new address', () => {
  const to = 'https://heyroamie.com/';
  assert.equal(movedUrl(at('https://dv2788.github.io/Tour-guide-App-/'), to), 'https://heyroamie.com/');
  assert.equal(movedUrl(at('https://dv2788.github.io/Tour-guide-App-/?tour=marrakesh&utm_source=card#x'), to), 'https://heyroamie.com/?tour=marrakesh&utm_source=card#x');
  assert.equal(movedUrl(at('https://dv2788.github.io/Tour-guide-App-/privacy.html'), to), 'https://heyroamie.com/privacy.html');
  // Already at the new address, or another site on github.io: stay.
  assert.equal(movedUrl(at('https://heyroamie.com/?tour=paris'), to), null);
  assert.equal(movedUrl(at('https://dv2788.github.io/other-project/'), to), null);
  // A crafted path can't send anyone elsewhere: it stays under the new address.
  assert.equal(new URL(movedUrl(at('https://dv2788.github.io/Tour-guide-App-//evil.example/x'), to)).hostname, 'heyroamie.com');
  for (const path of ['///evil.example/x', '////evil.example', '/\\evil.example', '//%2F%2Fevil.example']) {
    const url = movedUrl({ hostname: 'dv2788.github.io', pathname: `/Tour-guide-App-${path}`, search: '', hash: '' }, to);
    assert.equal(new URL(url).hostname, 'heyroamie.com', path);
  }
});
