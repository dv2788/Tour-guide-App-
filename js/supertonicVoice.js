// The Supertonic 3 voice: natural speech in 31 languages from one model, running on the phone
// (Supertone's open model, Open RAIL-M licence; https://github.com/supertone-inc/supertonic).
// It reads letters, not phonemes, so it needs no pronunciation dictionary; numbers are written
// out as words first (js/numbers.js). Four networks run in turn on ONNX Runtime Web: how long
// the sentence takes, what it says, the sound in a compact form refined over a few steps, and
// the waveform. The files are served by the app itself (8-bit, ~110 MB in all), downloaded
// once and kept on the device. Nothing you hear is sent anywhere.

import { fetchCached, isCached, loadOrt } from './neuralVoice.js';
import { spellNumbers } from './numbers.js';

export const SUPERTONIC_BASE = new URL('../voices/supertonic-3/', import.meta.url).href;
// The model's files, with the fingerprints of the published copies (checked after download,
// and each time they are read back from the device). Sizes weight the progress bar.
export const SUPERTONIC_FILES = {
  'tts.json': { size: 8253, integrity: 'sha384-cPNcczI4C+YO//D2UFv6B4M4ejxuMpB64pFgZ69eLywHzs6PTbXnfrBYwofzg+Cr' },
  'unicode_indexer.json': { size: 277676, integrity: 'sha384-wCLzdS9IaLF5BimSdOrubNpx4yNWm7fX0o5bD2VWtBdEp+7j/N39kt1iKGFmGoGS' },
  'duration_predictor.onnx': { size: 2752067, integrity: 'sha384-gPVbgk9iDi+offpCKQOzyXZCkjBEe6TvwMon7S75/uMUUmdCSHIOWv6qH75KKIJt' },
  'text_encoder.onnx': { size: 16059290, integrity: 'sha384-8AKydQ03xKOOzes9sf/Lk5aCTkEPBRgl6ejcH/fqWlcLJder0KE8F3PArDi+Ub6L' },
  'vector_estimator.onnx': { size: 65669575, integrity: 'sha384-bWhV+GspxtVD05rJtaAQwHXLrztVRhqTqACPuQmT4UfKN9YaZk7O6M9uElVWRmAQ' },
  'vocoder.onnx': { size: 25789493, integrity: 'sha384-djWfVcNWQLECezulEE49KGRyMguU5/weQqAIJ6uKsHuy9Dk5YP3arQoyqaUfPlhN' },
};
export const SUPERTONIC_STYLES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
export const SUPERTONIC_LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'];
// Refinement steps: 8 is the cleanest; each costs the same time. 'auto' picks as many as the
// phone can afford while staying ahead of the listener (never fewer than MIN_STEPS).
export const DEFAULT_STEPS = 'auto';
export const MAX_STEPS = 8;
export const MIN_STEPS = 3;
const FIRST_STEPS = 4; // before the phone's speed is known
const TARGET_RTF = 0.8; // seconds of work per second of speech we aim to stay under
const NATURAL_PACE = 1.12; // the app's calm pace (see VOICE_PROFILES) is this voice's natural rate
const MIN_SPEED = 0.7;
const MAX_SPEED = 2;
const MAX_CHUNK = 300; // characters the model takes in one go

const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const REPLACE = [
  ['–', '-'],
  ['‑', '-'],
  ['—', '-'],
  ['¯', ' '],
  ['_', ' '],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['´', "'"],
  ['`', "'"],
  ['[', ' '],
  [']', ' '],
  ['|', ' '],
  ['/', ' '],
  ['#', ' '],
  ['→', ' '],
  ['←', ' '],
];
const ENDS_WELL = /[.!?;:,'")\]}…。」』】〉》›»]$/;

/** The model's own text clean-up (as in its reference code), then the language tags it expects. */
export function preprocess(text, lang) {
  let t = text.normalize('NFKD').replace(EMOJI, '');
  for (const [from, to] of REPLACE) t = t.replaceAll(from, to);
  t = t
    .replace(/[♥☆♡©\\]/g, '')
    .replaceAll('@', ' at ')
    .replaceAll('e.g.,', 'for example, ')
    .replaceAll('i.e.,', 'that is, ')
    .replace(/ ([,.!?;:'])/g, '$1')
    .replace(/(["'`])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ENDS_WELL.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}

/** Characters to the model's indices; characters it never saw are left out. */
export function textToIds(text, indexer) {
  const ids = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const id = cp < indexer.length ? indexer[cp] : -1;
    if (id >= 0) ids.push(id);
  }
  return ids;
}

const SENTENCE_END = /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;

/** Sentences grouped into pieces the model takes in one go. */
export function chunkText(text, maxLen = MAX_CHUNK) {
  const chunks = [];
  for (const paragraph of text.trim().split(/\n\s*\n+/)) {
    let current = '';
    for (const sentence of paragraph.trim().split(SENTENCE_END)) {
      const s = sentence.trim();
      if (!s) continue;
      if (current.length + s.length + 1 <= maxLen) current += (current ? ' ' : '') + s;
      else {
        if (current) chunks.push(current);
        current = s;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

/** Standard normal samples (Box–Muller). A seeded `random` makes a sentence repeatable. */
export function gaussian(n, random = Math.random) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-7, random())));
    const a = 2 * Math.PI * random();
    out[i] = r * Math.cos(a);
    if (i + 1 < n) out[i + 1] = r * Math.sin(a);
  }
  return out;
}

/** A small repeatable random source (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const decode = (buf) => new TextDecoder().decode(buf);

/** Has the voice model already been downloaded to the device? (Its biggest file is the test.) */
export function isSupertonicDownloaded(base = SUPERTONIC_BASE) {
  return isCached(`${base}vector_estimator.onnx`);
}

const instances = new Map();

/** One shared instance per voice style, so a voice loaded for the preview is ready for the tour. */
export function getSupertonicVoice(style, options) {
  if (!instances.has(style)) instances.set(style, new SupertonicVoice(style, options));
  return instances.get(style);
}

export class SupertonicVoice {
  constructor(style = 'F1', { base = SUPERTONIC_BASE, steps = DEFAULT_STEPS, fold = false, seed = null, providers = ['wasm'] } = {}) {
    this.style = style;
    this.base = base;
    this.steps = steps;
    // fold: turn the 8-bit weights back into 32-bit numbers once, at load. Measured in the
    // browser it is three times slower and takes twice the memory, so the weights stay 8-bit
    // and are expanded on the fly (which costs nothing noticeable).
    this.fold = fold;
    this.providers = providers;
    this.random = seed == null ? Math.random : seeded(seed);
    this.loading = null;
    this.cost = null; // measured: { fixed, step } seconds of work per second of speech
  }

  /** How many refinement steps the next sentence gets. */
  stepsFor() {
    if (this.steps !== 'auto') return this.steps;
    if (!this.cost) return FIRST_STEPS;
    const n = Math.floor((TARGET_RTF - this.cost.fixed) / this.cost.step);
    return Math.max(MIN_STEPS, Math.min(MAX_STEPS, n));
  }

  /** What this voice needs done to the text first: numbers written out in its language. */
  static prepare(text, lang) {
    return spellNumbers(text, lang);
  }

  /** Download (first time) and start the voice. onProgress(fraction 0..1). */
  load(onProgress = () => {}) {
    this.loading ??= this.#load(onProgress).catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  async #load(onProgress) {
    const sizes = { ort: 10.6e6, style: 52e3 };
    for (const [name, { size }] of Object.entries(SUPERTONIC_FILES)) sizes[name] = size;
    const loaded = {};
    const report = (key) => (bytes, total) => {
      if (total) sizes[key] = total;
      loaded[key] = bytes;
      const all = Object.values(sizes).reduce((a, b) => a + b, 0);
      onProgress(Math.min(1, Object.values(loaded).reduce((a, b) => a + b, 0) / all));
    };
    const names = Object.keys(SUPERTONIC_FILES);
    const [ort, stylesBuf, styleBuf, ...bufs] = await Promise.all([
      loadOrt(report('ort')),
      fetchCached(`${this.base}voices/styles.json`),
      fetchCached(`${this.base}voices/${this.style}.bin`, report('style')),
      ...names.map((name) => fetchCached(`${this.base}${name}`, report(name), SUPERTONIC_FILES[name].integrity)),
    ]);
    const files = Object.fromEntries(names.map((name, i) => [name, bufs[i]]));
    this.config = JSON.parse(decode(files['tts.json']));
    this.indexer = JSON.parse(decode(files['unicode_indexer.json']));
    this.sampleRate = this.config.ae.sample_rate;
    // The voice: two small tensors of numbers describing how it sounds and how it paces.
    const dims = JSON.parse(decode(stylesBuf))[this.style];
    if (!dims) throw new Error(`Unknown voice style ${this.style}`);
    const count = (shape) => shape.reduce((a, b) => a * b, 1);
    const floats = new Float32Array(styleBuf);
    this.styleTtl = { data: floats.slice(0, count(dims.ttl)), dims: dims.ttl };
    this.styleDp = { data: floats.slice(count(dims.ttl), count(dims.ttl) + count(dims.dp)), dims: dims.dp };
    const options = { executionProviders: this.providers, graphOptimizationLevel: 'all' };
    if (this.fold) options.extra = { session: { disable_quant_qdq: '1' } };
    this.ort = ort;
    this.sessions = {};
    for (const name of ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']) {
      this.sessions[name] = await ort.InferenceSession.create(files[`${name}.onnx`], options); // one at a time: memory
    }
    this.session = this.sessions.vocoder; // "ready"
    onProgress(1);
  }

  get ready() {
    return !!this.session;
  }

  /**
   * Synthesize speech. pace > 1 speaks more slowly (as for the Piper voices: the app's calm
   * pace is this voice's natural rate). Returns { samples: Float32Array, sampleRate }.
   */
  async synthesize(text, { pace = 1, pause: pauseSeconds = 0.28, lang = 'en', steps = null } = {}) {
    await this.load();
    const language = SUPERTONIC_LANGS.includes(lang) ? lang : 'na';
    const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, NATURAL_PACE / pace));
    const pause = new Float32Array(Math.round(this.sampleRate * pauseSeconds));
    const parts = [];
    for (const chunk of chunkText(text)) {
      const samples = await this.#speak(chunk, language, speed, steps ?? this.stepsFor());
      if (parts.length) parts.push(pause);
      parts.push(samples);
    }
    const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      samples.set(p, offset);
      offset += p.length;
    }
    return { samples, sampleRate: this.sampleRate };
  }

  async #speak(text, lang, speed, steps) {
    const { ort, config, sessions } = this;
    const ids = textToIds(preprocess(text, lang), this.indexer);
    const length = ids.length;
    // Fresh tensors for every run: the runtime may hand them to its worker, which empties them here.
    const tensor = ({ data, dims }) => new ort.Tensor(data instanceof BigInt64Array ? 'int64' : 'float32', data.slice(), dims);
    const textIds = { data: BigInt64Array.from(ids, BigInt), dims: [1, length] };
    const textMask = { data: new Float32Array(length).fill(1), dims: [1, 1, length] };
    const now = () => (globalThis.performance ?? Date).now();
    const t0 = now();
    // 1. How long it takes to say; 2. what it says.
    const { duration } = await sessions.duration_predictor.run({ text_ids: tensor(textIds), style_dp: tensor(this.styleDp), text_mask: tensor(textMask) });
    const seconds = duration.data[0] / speed;
    const { text_emb: textEmb } = await sessions.text_encoder.run({ text_ids: tensor(textIds), style_ttl: tensor(this.styleTtl), text_mask: tensor(textMask) });
    // 3. The sound in compact form, refined from noise over a few steps.
    const frame = config.ae.base_chunk_size * config.ttl.chunk_compress_factor; // samples per compact frame
    const dim = config.ttl.latent_dim * config.ttl.chunk_compress_factor;
    const wavLength = Math.floor(seconds * this.sampleRate);
    const frames = Math.ceil(wavLength / frame);
    let latent = gaussian(dim * frames, this.random);
    const latentMask = { data: new Float32Array(frames).fill(1), dims: [1, 1, frames] };
    const t1 = now();
    for (let step = 0; step < steps; step++) {
      const out = await sessions.vector_estimator.run({
        noisy_latent: new ort.Tensor('float32', latent, [1, dim, frames]),
        text_emb: tensor(textEmb),
        style_ttl: tensor(this.styleTtl),
        latent_mask: tensor(latentMask),
        text_mask: tensor(textMask),
        current_step: new ort.Tensor('float32', Float32Array.from([step]), [1]),
        total_step: new ort.Tensor('float32', Float32Array.from([steps]), [1]),
      });
      latent = out.denoised_latent.data;
    }
    const t2 = now();
    // 4. The waveform. It covers whole frames: keep what the sentence takes, plus a breath.
    const { wav_tts: wav } = await sessions.vocoder.run({ latent: new ort.Tensor('float32', latent, [1, dim, frames]) });
    this.#learnSpeed((t1 - t0 + now() - t2) / 1000, (t2 - t1) / 1000 / steps, seconds);
    return wav.data.slice(0, Math.min(wav.data.length, wavLength + Math.round(this.sampleRate * 0.05)));
  }

  /** Remember how long the fixed work and one step take per second of speech (smoothed). */
  #learnSpeed(fixedSeconds, stepSeconds, speechSeconds) {
    if (!(speechSeconds > 0.5)) return;
    const sample = { fixed: fixedSeconds / speechSeconds, step: stepSeconds / speechSeconds };
    this.cost = this.cost ? { fixed: 0.5 * (this.cost.fixed + sample.fixed), step: 0.5 * (this.cost.step + sample.step) } : sample;
  }
}
