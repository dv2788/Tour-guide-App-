// Roamie Plus: one payment that opens every city and every voice, for good.
//
// Always free: your first city (walk as many tours there as you like), every tour "from the
// couch", one AI voice per language and the phone's own voices.
//
// Payment, receipts, VAT and refunds: Polar (polar.sh), the seller of record. The buyer gets a
// key by email; the app checks it with Polar's public licence API, straight from the phone (no
// server of ours). A key works on up to 3 phones (set in Polar); buyers free a phone in Polar's
// customer portal. Like any app that runs entirely on the phone, a determined person could get
// round this: it keeps honest people honest, which is what a fair price is for.
//
// Nothing is recorded while Plus is switched off (js/plus-config.js empty).

import { PLUS_CONFIG } from './plus-config.js';
import { NEURAL_VOICES, neuralVoiceKey, parseVoiceKey } from './voices.js';
import { distanceMeters } from './geo.js';

export const POLAR_LICENSE_API = 'https://api.polar.sh/v1/customer-portal/license-keys';
const STATE_KEY = 'roamie:plus';
const CITIES_KEY = 'roamie:cities';
const DAY_MS = 86400000;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Plus is on once the Polar organisation and checkout link are filled in. */
export function plusConfigured(config = PLUS_CONFIG) {
  return UUID4.test(config?.organizationId ?? '') && /^https:\/\/[^\s"'<>]+$/.test(config?.checkoutUrl ?? '');
}

/** A key as pasted from an email: spaces and line breaks removed. */
export function cleanKey(text) {
  return String(text ?? '').replace(/\s+/g, '');
}

/** Looks like a key at all? (Polar keys: a prefix and a UUID, e.g. "ROAMIE-2CA57A34-E191-…".) */
export function plausibleKey(key) {
  return /^[A-Za-z0-9_-]{8,100}$/.test(key);
}

/** Free without Plus: the phone's voices, and the first AI voice of each language. */
export function isFreeVoice(lang, key) {
  const parsed = parseVoiceKey(key);
  if (!parsed || parsed.kind === 'system') return true;
  const first = NEURAL_VOICES[lang]?.[0];
  return !!first && neuralVoiceKey(first) === neuralVoiceKey(parsed);
}

/** The free AI voice for a language ({ id, label, … }). */
export function freeVoice(lang) {
  return NEURAL_VOICES[lang]?.[0] ?? NEURAL_VOICES.en[0];
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked: nothing is remembered
  }
}

const round2 = (v) => Math.round(v * 100) / 100; // ~1 km: enough to tell cities apart
const hasPoint = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);

export function createPlus({
  config = PLUS_CONFIG,
  storage = defaultStorage(),
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const enabled = plusConfigured(config);

  const read = (key, fallback) => {
    try {
      return JSON.parse(storage?.getItem(key) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      if (value == null) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(value));
    } catch {
      // full or blocked: Plus still works for this visit
    }
  };
  const state = () => {
    const s = read(STATE_KEY, null);
    return s && typeof s.key === 'string' && plausibleKey(s.key) ? s : null;
  };
  const cities = () => {
    const list = read(CITIES_KEY, []);
    return Array.isArray(list) ? list.filter(hasPoint) : [];
  };

  const post = (path, body) =>
    fetchImpl(`${POLAR_LICENSE_API}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...body, organization_id: config.organizationId }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: globalThis.AbortSignal?.timeout?.(12000),
    });
  const detail = async (res) => {
    try {
      const body = await res.json();
      return { error: String(body?.error ?? ''), text: String(body?.detail ?? '') };
    } catch {
      return { error: '', text: '' };
    }
  };

  const plus = {
    enabled,
    config,

    /** Has this phone got Plus? (Always false while Plus is switched off: nothing is locked then.) */
    get active() {
      return enabled && !!state();
    },

    /** The end of the key, to show which one this phone uses ("…7A8C"). */
    get keyHint() {
      const s = state();
      return s ? `…${s.key.slice(-4)}` : '';
    },

    /** May this voice read a tour? */
    voiceAllowed(lang, key) {
      return !enabled || plus.active || isFreeVoice(lang, key);
    },

    /** The city walked for free so far, if any ({ name, lat, lon }). */
    freeCity() {
      return cities()[0] ?? null;
    },

    /**
     * May a real tour start here? place: { name, lat, lon } (where you are).
     * Same city as one already walked (within sameCityKm), or a free city left: yes.
     */
    cityStatus(place) {
      if (!enabled || plus.active) return { allowed: true };
      if (!hasPoint(place)) return { allowed: true, unknown: true };
      const walked = cities();
      const same = walked.find((c) => distanceMeters(c, place) <= config.sameCityKm * 1000);
      if (same) return { allowed: true, city: same };
      if (walked.length < config.freeCities) return { allowed: true, isNew: true };
      return { allowed: false, freeCity: walked[0] };
    },

    /** Remember a city walked for real (only while Plus is on and not bought: it's what counts). */
    recordCity(place) {
      if (!enabled || plus.active || !hasPoint(place)) return;
      const walked = cities();
      if (walked.some((c) => distanceMeters(c, place) <= config.sameCityKm * 1000)) return;
      if (walked.length >= config.freeCities) return;
      const name = typeof place.name === 'string' ? place.name.slice(0, 80) : null;
      write(CITIES_KEY, [...walked, { name, lat: round2(place.lat), lon: round2(place.lon) }]);
    },

    /**
     * Unlock Plus on this phone with a key. Resolves { ok: true } or { ok: false, error } where
     * error is 'format' | 'invalid' | 'limit' | 'inactive' | 'network'.
     */
    async unlock(text) {
      if (!enabled) return { ok: false, error: 'network' };
      const key = cleanKey(text);
      if (!plausibleKey(key)) return { ok: false, error: 'format' };
      const since = now();
      const save = (activationId) => {
        write(STATE_KEY, { key, activationId: activationId ?? null, since, checkedAt: since });
        return { ok: true };
      };
      try {
        // Count this phone against the key's limit (the label shows in the buyer's portal).
        const day = new Date(since).toISOString().slice(0, 10);
        const res = await post('activate', { key, label: `Roamie, added ${day}` });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          return save(typeof body?.id === 'string' ? body.id : null);
        }
        const { text: why } = await detail(res);
        if (res.status === 403 && /support activations/i.test(why)) {
          // A key with no phone limit: checking it is enough.
          const check = await post('validate', { key });
          if (check.ok) return save(null);
          return { ok: false, error: check.status === 404 || check.status === 422 ? 'invalid' : 'network' };
        }
        if (res.status === 403 && /limit/i.test(why)) return { ok: false, error: 'limit' };
        if (res.status === 403) return { ok: false, error: 'inactive' };
        if (res.status === 404 || res.status === 422) return { ok: false, error: 'invalid' };
        return { ok: false, error: 'network' };
      } catch {
        return { ok: false, error: 'network' };
      }
    },

    /**
     * Check the key again now and then (a refunded key, or a phone freed in the portal, stops
     * working). Only Polar saying "not found" removes Plus: no signal, a timeout or a busy
     * server never does. Resolves 'none' | 'fresh' | 'valid' | 'revoked' | 'offline'.
     */
    async recheck({ force = false } = {}) {
      const s = enabled ? state() : null;
      if (!s) return 'none';
      if (!force && now() - (s.checkedAt ?? 0) < config.recheckDays * DAY_MS) return 'fresh';
      try {
        const res = await post('validate', { key: s.key, ...(s.activationId ? { activation_id: s.activationId } : {}) });
        if (res.ok) {
          write(STATE_KEY, { ...s, checkedAt: now() });
          return 'valid';
        }
        if (res.status === 404 && (await detail(res)).error === 'ResourceNotFound') {
          write(STATE_KEY, null);
          return 'revoked';
        }
        return 'offline';
      } catch {
        return 'offline';
      }
    },

    /**
     * Remove Plus from this phone and give its place back to the key (so another phone can use
     * it). The key itself still works: enter it again to restore. Resolves true if Polar freed
     * the place, false if it couldn't be reached (the buyer can free it in the portal).
     */
    async forget() {
      const s = state();
      write(STATE_KEY, null);
      if (!enabled || !s?.activationId) return true;
      try {
        const res = await post('deactivate', { key: s.key, activation_id: s.activationId });
        return res.ok || res.status === 404;
      } catch {
        return false;
      }
    },
  };
  return plus;
}
