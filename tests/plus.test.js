import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlus, plusConfigured, isFreeVoice, cleanKey, plausibleKey, freeVoice, POLAR_LICENSE_API } from '../js/plus.js';
import { PLUS_CONFIG } from '../js/plus-config.js';
import { NEURAL_VOICES, neuralVoiceKey } from '../js/voices.js';

const ON = { ...PLUS_CONFIG, organizationId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', checkoutUrl: 'https://buy.polar.sh/polar_cl_test' };
const KEY = 'ROAMIE-2CA57A34-E191-4290-A394-ADC2ABC48A7C';
const BARCELONA = { name: 'Barcelona', lat: 41.3874, lon: 2.1686 };
const BADALONA = { name: 'Badalona', lat: 41.4500, lon: 2.2474 }; // 10 km away: the same city for Plus
const PARIS = { name: 'Paris', lat: 48.8566, lon: 2.3522 };

function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

/** A fake Polar: answers per endpoint, and records what was asked. */
function polar(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace(`${POLAR_LICENSE_API}/`, '');
    const body = JSON.parse(init.body);
    calls.push({ path, body, init });
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    const [status, json] = typeof answer === 'function' ? answer(body) : answer ?? [500, {}];
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return { fetchImpl, calls };
}

test('Plus stays off (nothing locked, nothing recorded) until Polar is set up', () => {
  assert.equal(plusConfigured(PLUS_CONFIG), false, 'the shipped settings leave Plus off');
  assert.equal(plusConfigured(ON), true);
  assert.equal(plusConfigured({ ...ON, organizationId: 'not-a-uuid' }), false);
  assert.equal(plusConfigured({ ...ON, checkoutUrl: 'http://buy.polar.sh/x' }), false, 'https only');
  const storage = memory();
  const plus = createPlus({ config: PLUS_CONFIG, storage });
  assert.equal(plus.enabled, false);
  assert.equal(plus.voiceAllowed('en', 'neural:en_GB-vctk-medium:10'), true);
  plus.recordCity(BARCELONA);
  assert.equal(plus.cityStatus(PARIS).allowed, true);
  assert.equal(storage.data.size, 0, 'no city history kept while Plus is off');
});

test('the first AI voice of each language and the phone voices are free; the others need Plus', () => {
  for (const [lang, voices] of Object.entries(NEURAL_VOICES)) {
    assert.equal(isFreeVoice(lang, neuralVoiceKey(voices[0])), true, `${lang}: ${voices[0].label} is free`);
    assert.equal(freeVoice(lang).label, voices[0].label);
    for (const v of voices.slice(1)) assert.equal(isFreeVoice(lang, neuralVoiceKey(v)), false, `${lang}: ${v.label} needs Plus`);
  }
  assert.equal(isFreeVoice('en', 'system:Samantha'), true);
  assert.equal(isFreeVoice('en', 'system:'), true);
  // Same model, other speaker: Arthur and Pierre are speakers of multi-voice models.
  assert.equal(isFreeVoice('fr', 'neural:fr_FR-upmc-medium:1'), false);
  const plus = createPlus({ config: ON, storage: memory() });
  assert.equal(plus.voiceAllowed('en', 'neural:en_GB-vctk-medium:10'), false);
  assert.equal(plus.voiceAllowed('en', 'neural:en_GB-jenny_dioco-medium:0'), true);
});

test('one free city: walk it as often as you like, its suburbs included; a second city needs Plus', () => {
  const storage = memory();
  const plus = createPlus({ config: ON, storage });
  assert.deepEqual(plus.cityStatus(BARCELONA), { allowed: true, isNew: true });
  plus.recordCity(BARCELONA);
  assert.equal(plus.freeCity().name, 'Barcelona');
  assert.equal(plus.cityStatus(BARCELONA).allowed, true);
  assert.equal(plus.cityStatus(BADALONA).allowed, true, 'within 25 km: the same city');
  const paris = plus.cityStatus(PARIS);
  assert.equal(paris.allowed, false);
  assert.equal(paris.freeCity.name, 'Barcelona');
  plus.recordCity(PARIS); // never recorded beyond the free allowance
  assert.equal(JSON.parse(storage.data.get('roamie:cities')).length, 1);
  // Only a rough position is kept (two decimals, about a kilometre).
  assert.deepEqual(JSON.parse(storage.data.get('roamie:cities')), [{ name: 'Barcelona', lat: 41.39, lon: 2.17 }]);
  // Where you are can't be known yet (no GPS fix): don't block.
  assert.equal(plus.cityStatus(null).allowed, true);
});

test('a key unlocks Plus on this phone, counting it against the key’s phone limit', async () => {
  const storage = memory();
  const { fetchImpl, calls } = polar({ activate: [200, { id: 'act-1', license_key: { status: 'granted' } }] });
  const plus = createPlus({ config: ON, storage, fetchImpl, now: () => Date.UTC(2026, 10, 2) });
  const result = await plus.unlock(`  ${KEY.slice(0, 20)}\n${KEY.slice(20)} `);
  assert.deepEqual(result, { ok: true });
  assert.equal(plus.active, true);
  assert.equal(plus.keyHint, '…8A7C');
  assert.equal(calls[0].path, 'activate');
  assert.deepEqual(calls[0].body, { key: KEY, label: 'Roamie, added 2026-11-02', organization_id: ON.organizationId });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  // With Plus, every city and voice.
  plus.recordCity(BARCELONA);
  assert.equal(plus.cityStatus(PARIS).allowed, true);
  assert.equal(plus.voiceAllowed('en', 'neural:en_GB-vctk-medium:10'), true);
  assert.equal(storage.data.has('roamie:cities'), false, 'no city history once Plus is bought');
});

test('a key without a phone limit is checked instead', async () => {
  const { fetchImpl, calls } = polar({
    activate: [403, { error: 'NotPermitted', detail: 'This license key does not support activations. Use the /validate endpoint instead to check license validity.' }],
    validate: [200, { status: 'granted' }],
  });
  const plus = createPlus({ config: ON, storage: memory(), fetchImpl });
  assert.deepEqual(await plus.unlock(KEY), { ok: true });
  assert.deepEqual(calls.map((c) => c.path), ['activate', 'validate']);
});

test('a wrong, used-up, refunded or mistyped key is refused with the reason', async () => {
  const cases = [
    [{ activate: [404, { error: 'ResourceNotFound', detail: 'Not found' }] }, 'invalid'],
    [{ activate: [403, { error: 'NotPermitted', detail: 'License key activation limit already reached' }] }, 'limit'],
    [{ activate: [403, { error: 'NotPermitted', detail: 'License key is no longer active. This license key can not be activated.' }] }, 'inactive'],
    [{ activate: [503, {}] }, 'network'],
    [{ activate: new TypeError('Failed to fetch') }, 'network'],
  ];
  for (const [answers, error] of cases) {
    const storage = memory();
    const plus = createPlus({ config: ON, storage, fetchImpl: polar(answers).fetchImpl });
    assert.deepEqual(await plus.unlock(KEY), { ok: false, error });
    assert.equal(plus.active, false);
  }
  const { fetchImpl, calls } = polar({});
  const plus = createPlus({ config: ON, storage: memory(), fetchImpl });
  assert.deepEqual(await plus.unlock('my key?'), { ok: false, error: 'format' });
  assert.equal(calls.length, 0, 'not sent: it is not a key');
  assert.equal(cleanKey(' AB CD\n'), 'ABCD');
  assert.equal(plausibleKey(KEY), true);
  assert.equal(plausibleKey('<script>'), false);
});

test('the key is checked again weekly; only Polar saying "not found" removes Plus', async () => {
  let t = Date.UTC(2026, 10, 2);
  const storage = memory();
  const answers = { activate: [200, { id: 'act-1' }] };
  const { fetchImpl, calls } = polar(answers);
  const plus = createPlus({ config: ON, storage, fetchImpl, now: () => t });
  await plus.unlock(KEY);
  assert.equal(await plus.recheck(), 'fresh', 'checked less than a week ago');
  t += 8 * 86400000;
  answers.validate = new TypeError('offline');
  assert.equal(await plus.recheck(), 'offline');
  answers.validate = [429, {}];
  assert.equal(await plus.recheck(), 'offline');
  answers.validate = [500, {}];
  assert.equal(await plus.recheck(), 'offline');
  assert.equal(plus.active, true, 'no signal or a busy server never takes Plus away');
  answers.validate = [200, { status: 'granted' }];
  assert.equal(await plus.recheck(), 'valid');
  assert.deepEqual(calls.at(-1).body, { key: KEY, activation_id: 'act-1', organization_id: ON.organizationId });
  assert.equal(await plus.recheck(), 'fresh');
  t += 8 * 86400000;
  answers.validate = [404, { error: 'ResourceNotFound', detail: 'License key is no longer active.' }];
  assert.equal(await plus.recheck(), 'revoked');
  assert.equal(plus.active, false);
});

test('removing Plus from a phone frees its place on the key', async () => {
  const answers = { activate: [200, { id: 'act-1' }], deactivate: [204, null] };
  const { fetchImpl, calls } = polar(answers);
  const plus = createPlus({ config: ON, storage: memory(), fetchImpl });
  await plus.unlock(KEY);
  assert.equal(await plus.forget(), true);
  assert.equal(plus.active, false);
  assert.deepEqual(calls.at(-1), { ...calls.at(-1), path: 'deactivate', body: { key: KEY, activation_id: 'act-1', organization_id: ON.organizationId } });
  // Offline: removed here anyway; the buyer can free the place in Polar's portal.
  answers.deactivate = new TypeError('offline');
  await plus.unlock(KEY);
  assert.equal(await plus.forget(), false);
  assert.equal(plus.active, false);
});

test('blocked or broken storage never breaks the app', async () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } };
  const plus = createPlus({ config: ON, storage: broken, fetchImpl: polar({ activate: [200, { id: 'a' }] }).fetchImpl });
  assert.equal(plus.active, false);
  assert.equal(plus.cityStatus(PARIS).allowed, true);
  plus.recordCity(PARIS);
  assert.deepEqual(await plus.unlock(KEY), { ok: true });
  const garbage = memory();
  garbage.setItem('roamie:plus', '{"key":"<img src=x>"}');
  garbage.setItem('roamie:cities', '"oops"');
  const p2 = createPlus({ config: ON, storage: garbage });
  assert.equal(p2.active, false, 'a malformed saved key is ignored');
  assert.equal(p2.freeCity(), null);
});
