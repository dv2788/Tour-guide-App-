// A natural, calm AI voice that runs entirely on the phone: Piper neural text-to-speech
// (https://github.com/rhasspy/piper, MIT licence) running on ONNX Runtime Web.
// Downloaded once (~80 MB), then cached on the device and usable offline. No account,
// no API key, and nothing you hear is sent to a server.

const ORT_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const ORT_SCRIPT = { src: `${ORT_BASE}ort.wasm.min.js`, integrity: 'sha384-SgeB7YRZLYVIvNteTHalidIdVwoxCxFIEnAbq/xbds9+tUeuA7rCxn0j5AwZFUSW' };
// Turns text into the phonemes the voice model reads (espeak-ng compiled to WebAssembly).
const PHONEMIZER_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const PHONEMIZER_SCRIPT = { src: `${PHONEMIZER_BASE}.js`, integrity: 'sha384-PMufGRTCTqKC0tPjOTp2UFXycN+yWWjDareOeoy106zJZAHPijaeHDAX/4Pi0I5S' };
// Voice models, pinned to one revision of the official collection so files never change under us.
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/b4e358ffcb232591bf73a540e70f7de528e4174a/';
const CACHE_NAME = 'tour-guide-voices-v1';
// Fingerprints of the WebAssembly code we run (checked against a second download source):
// like the scripts' integrity attributes, a changed file on a CDN is refused, not run.
const PHONEMIZER_WASM = { url: `${PHONEMIZER_BASE}.wasm`, integrity: 'sha384-p7p53pHMdJ/Czq5r8i0cXWVgLA+CeXEeki1NGyNN0BKfNFLIdxeg0R0+5SzNSop3' };
// Its pronunciation dictionary (data, read by that code): checked against the npm package too.
const PHONEMIZER_DATA = { url: `${PHONEMIZER_BASE}.data`, integrity: 'sha384-6Xh3BfiH+X7e4My11k66vDp7WUWQmn5Ifmsx4ZB1wg8vA9+lmOUucunqJpNsNUuf' };
const ORT_WASM = {
  'ort-wasm-simd.wasm': 'sha384-fRaLGPIzvF2phGW4iOtonTas/h/+gi5pnuRbYIFDHMAY6wl8PjBiOd42lVUpDaNd',
  'ort-wasm.wasm': 'sha384-knZ5sDiuTisFgxBlwY3twQEH8QlgshupTIFY2Ssx2fz41zpiv8Z4aKFrd93WosAw',
};
// The test ONNX Runtime 1.18 runs to choose its SIMD build: we pick (and check) the same file.
const SIMD_TEST = [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11];
export function ortWasmFile() {
  try {
    return WebAssembly.validate(new Uint8Array(SIMD_TEST)) ? 'ort-wasm-simd.wasm' : 'ort-wasm.wasm';
  } catch {
    return 'ort-wasm.wasm';
  }
}

/** Does this file match its fingerprint ("sha384-…")? */
export async function matchesIntegrity(buf, integrity) {
  const [algo, expected] = integrity.split('-');
  const digest = new Uint8Array(await crypto.subtle.digest(algo.replace('sha', 'SHA-'), buf));
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary) === expected;
}

const scripts = new Map();
function loadScript({ src, integrity }) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.integrity = integrity;
        el.crossOrigin = 'anonymous';
        el.onload = resolve;
        el.onerror = () => {
          scripts.delete(src);
          reject(new Error(`Could not load ${src}`));
        };
        document.head.append(el);
      }),
    );
  }
  return scripts.get(src);
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null; // private browsing etc.: works, just re-downloads next time
  }
}

/**
 * Download a file once and keep it on the device. Reports progress in bytes. With an
 * integrity fingerprint, a file that doesn't match (downloaded or kept) is thrown away.
 */
async function fetchCached(url, onBytes = () => {}, integrity = null) {
  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) {
    const buf = await hit.arrayBuffer();
    if (!integrity || (await matchesIntegrity(buf, integrity))) {
      onBytes(buf.byteLength, buf.byteLength);
      return buf;
    }
    await cache.delete(url).catch(() => {});
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  let buf;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.byteLength;
      onBytes(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes(buf.byteLength, buf.byteLength);
  }
  if (integrity && !(await matchesIntegrity(buf, integrity))) throw new Error(`${url} did not match its fingerprint: not used`);
  try {
    await cache?.put(url, new Response(buf.slice(0)));
  } catch {
    // storage full: fine, we still have it in memory
  }
  return buf;
}

export function voiceFiles(voiceId) {
  const [locale, name, quality] = voiceId.split('-');
  const family = locale.split('_')[0];
  const base = `${VOICES_BASE}${family}/${locale}/${name}/${quality}/${voiceId}.onnx`;
  return { model: base, config: `${base}.json` };
}

/** Has this voice already been downloaded to the device? */
export async function isVoiceDownloaded(voiceId) {
  const cache = await openCache();
  return !!(await cache?.match(voiceFiles(voiceId).model));
}

export function neuralVoicesSupported() {
  return typeof WebAssembly === 'object' && typeof fetch === 'function' && !!(window.AudioContext || window.webkitAudioContext);
}

const instances = new Map();

/** One shared instance per voice, so a voice loaded for the preview is ready for the tour. */
export function getPiperVoice(voiceId, speaker = 0) {
  const key = `${voiceId}:${speaker}`;
  if (!instances.has(key)) instances.set(key, new PiperVoice(voiceId, { speaker }));
  return instances.get(key);
}

export class PiperVoice {
  constructor(voiceId, { speaker = 0 } = {}) {
    this.voiceId = voiceId;
    this.speaker = speaker;
    this.loading = null;
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
    const files = voiceFiles(this.voiceId);
    // Rough sizes, only used to weight the progress bar before servers tell us exact ones.
    const ortFile = ortWasmFile();
    const sizes = { model: 63e6, data: 18.1e6, wasm: 0.64e6, ort: ortFile === 'ort-wasm.wasm' ? 9.8e6 : 10.6e6 };
    const loaded = { model: 0, data: 0, wasm: 0, ort: 0 };
    const report = (key) => (bytes, total) => {
      if (total) sizes[key] = total;
      loaded[key] = bytes;
      const all = Object.values(sizes).reduce((a, b) => a + b, 0);
      onProgress(Math.min(1, Object.values(loaded).reduce((a, b) => a + b, 0) / all));
    };

    const [, , configBuf, modelBuf, wasm, data, ortWasm] = await Promise.all([
      loadScript(ORT_SCRIPT),
      loadScript(PHONEMIZER_SCRIPT),
      fetchCached(files.config),
      fetchCached(files.model, report('model')),
      fetchCached(PHONEMIZER_WASM.url, report('wasm'), PHONEMIZER_WASM.integrity),
      fetchCached(PHONEMIZER_DATA.url, report('data'), PHONEMIZER_DATA.integrity),
      fetchCached(`${ORT_BASE}${ortFile}`, report('ort'), ORT_WASM[ortFile]),
    ]);
    this.config = JSON.parse(new TextDecoder().decode(configBuf));
    this.sampleRate = this.config.audio.sample_rate;
    this.phonemizerWasm = wasm;
    this.phonemizerData = data;

    const ort = window.ort;
    // Run the copy we checked (and keep on the device), not a fresh unchecked download. One thread:
    // threads need cross-origin isolation, which GitHub Pages can't give.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { [ortFile]: URL.createObjectURL(new Blob([ortWasm], { type: 'application/wasm' })) };
    this.ort = ort;
    this.session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });
    onProgress(1);
  }

  /** Text -> phoneme ids, one list per sentence. */
  #phonemize(text) {
    return new Promise((resolve, reject) => {
      const sentences = [];
      window
        .createPiperPhonemize({
          print: (line) => {
            try {
              sentences.push(JSON.parse(line).phoneme_ids);
            } catch {
              // not a result line
            }
          },
          printErr: () => {},
          wasmBinary: this.phonemizerWasm,
          getPreloadedPackage: () => this.phonemizerData,
          locateFile: (file) => (file.endsWith('.wasm') ? `${PHONEMIZER_BASE}.wasm` : `${PHONEMIZER_BASE}.data`),
        })
        .then((module) => {
          module.callMain([
            '-l',
            this.config.espeak.voice,
            '--input',
            JSON.stringify([{ text }]),
            '--espeak_data',
            '/espeak-ng-data',
          ]);
          resolve(sentences);
        }, reject);
    });
  }

  /**
   * Synthesize speech. pace > 1 speaks more slowly (Piper's length_scale), which is the
   * single biggest lever for a calm delivery. Returns { samples: Float32Array, sampleRate }.
   */
  async synthesize(text, { pace = 1, pause: pauseSeconds = 0.28 } = {}) {
    await this.load();
    const { inference, speaker_id_map: speakers } = this.config;
    const sentences = await this.#phonemize(text);
    const pause = new Float32Array(Math.round(this.sampleRate * pauseSeconds)); // a breath between sentences
    const parts = [];
    for (const ids of sentences) {
      if (!ids?.length) continue;
      const feeds = {
        input: new this.ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new this.ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new this.ort.Tensor('float32', Float32Array.from([inference.noise_scale, inference.length_scale * pace, inference.noise_w]), [3]),
      };
      if (speakers && Object.keys(speakers).length) {
        feeds.sid = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(this.speaker)]), [1]);
      }
      const { output } = await this.session.run(feeds);
      if (parts.length) parts.push(pause);
      parts.push(output.data);
    }
    const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      samples.set(p, offset);
      offset += p.length;
    }
    return { samples, sampleRate: this.sampleRate };
  }
}

/**
 * The "warmth" EQ: a soft cut of the harsh high frequencies (sibilance, hiss) and a slight
 * lift of the low body of the voice. Returns the node to connect sources to.
 */
function warmthChain(ctx, destination, eq = { low: 2, high: -4 }) {
  const warmth = ctx.createBiquadFilter();
  warmth.type = 'highshelf';
  warmth.frequency.value = 4500;
  warmth.gain.value = eq.high;
  const body = ctx.createBiquadFilter();
  body.type = 'lowshelf';
  body.frequency.value = 220;
  body.gain.value = eq.low;
  warmth.connect(body).connect(destination);
  return warmth;
}

/** Short fades in and out so a sentence never starts or ends with a click. */
function withFades(samples, sampleRate) {
  const fade = Math.min(Math.round(sampleRate * 0.015), samples.length >> 1);
  const shaped = samples.slice();
  for (let i = 0; i < fade; i++) {
    shaped[i] *= i / fade;
    shaped[shaped.length - 1 - i] *= i / fade;
  }
  return shaped;
}

/** Exactly what the listener hears, rendered offline (used for voice samples and tests). */
export async function renderSoothing({ samples, sampleRate }, { pitch = 1, eq } = {}) {
  const ctx = new OfflineAudioContext(1, Math.ceil(samples.length / pitch), sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(withFades(samples, sampleRate), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = pitch;
  src.connect(warmthChain(ctx, ctx.destination, eq));
  src.start();
  return { samples: (await ctx.startRendering()).getChannelData(0), sampleRate };
}

/** Plays synthesized speech through Web Audio with the warmth EQ (and optional deeper pitch). */
export class SoothingPlayer {
  constructor({ pitch = 1, eq } = {}) {
    this.pitch = pitch;
    this.eq = eq;
  }

  unlock() {
    // Call from a tap. 'playback' lets iPhones play even with the silent switch on.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // not supported
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx ??= new Ctx();
    this.ctx.resume?.();
    const silent = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = silent;
    src.connect(this.ctx.destination);
    src.start();
    this.output ??= warmthChain(this.ctx, this.ctx.destination, this.eq);
  }

  /** Play samples; resolves when finished. stop() ends it early. */
  play({ samples, sampleRate }) {
    if (!this.ctx) this.unlock();
    const shaped = withFades(samples, sampleRate);
    const buffer = this.ctx.createBuffer(1, shaped.length, sampleRate);
    buffer.copyToChannel(shaped, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.pitch;
    src.connect(this.output);
    this.ctx.resume?.();
    const done = new Promise((resolve) => (src.onended = resolve));
    src.start();
    this.current = src;
    return done;
  }

  stop() {
    try {
      this.current?.stop();
    } catch {
      // already stopped
    }
    this.current = null;
  }
}
