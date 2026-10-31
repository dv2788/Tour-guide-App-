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
const SENTENCE_PAUSE_S = 0.28; // a calm breath between sentences

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

/** Download a file once and keep it on the device. Reports progress in bytes. */
async function fetchCached(url, onBytes = () => {}) {
  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) {
    const buf = await hit.arrayBuffer();
    onBytes(buf.byteLength, buf.byteLength);
    return buf;
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
    const sizes = { model: 63e6, data: 18.1e6, wasm: 0.64e6 };
    const loaded = { model: 0, data: 0, wasm: 0 };
    const report = (key) => (bytes, total) => {
      if (total) sizes[key] = total;
      loaded[key] = bytes;
      const all = Object.values(sizes).reduce((a, b) => a + b, 0);
      onProgress(Math.min(1, Object.values(loaded).reduce((a, b) => a + b, 0) / all));
    };

    const [, , configBuf, modelBuf, wasm, data] = await Promise.all([
      loadScript(ORT_SCRIPT),
      loadScript(PHONEMIZER_SCRIPT),
      fetchCached(files.config),
      fetchCached(files.model, report('model')),
      fetchCached(`${PHONEMIZER_BASE}.wasm`, report('wasm')),
      fetchCached(`${PHONEMIZER_BASE}.data`, report('data')),
    ]);
    this.config = JSON.parse(new TextDecoder().decode(configBuf));
    this.sampleRate = this.config.audio.sample_rate;
    this.phonemizerWasm = wasm;
    this.phonemizerData = data;

    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
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
  async synthesize(text, { pace = 1 } = {}) {
    await this.load();
    const { inference, speaker_id_map: speakers } = this.config;
    const sentences = await this.#phonemize(text);
    const pause = new Float32Array(Math.round(this.sampleRate * SENTENCE_PAUSE_S));
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
function warmthChain(ctx, destination) {
  const warmth = ctx.createBiquadFilter();
  warmth.type = 'highshelf';
  warmth.frequency.value = 4500;
  warmth.gain.value = -4;
  const body = ctx.createBiquadFilter();
  body.type = 'lowshelf';
  body.frequency.value = 220;
  body.gain.value = 2;
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
export async function renderSoothing({ samples, sampleRate }) {
  const ctx = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(withFades(samples, sampleRate), 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(warmthChain(ctx, ctx.destination));
  src.start();
  return { samples: (await ctx.startRendering()).getChannelData(0), sampleRate };
}

/** Plays synthesized speech through Web Audio with the warmth EQ. */
export class SoothingPlayer {
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
    this.output ??= warmthChain(this.ctx, this.ctx.destination);
  }

  /** Play samples; resolves when finished. stop() ends it early. */
  play({ samples, sampleRate }) {
    if (!this.ctx) this.unlock();
    const shaped = withFades(samples, sampleRate);
    const buffer = this.ctx.createBuffer(1, shaped.length, sampleRate);
    buffer.copyToChannel(shaped, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
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
