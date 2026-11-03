// The voice. A queue of things to say (arrivals jump ahead), pause/skip/repeat, and two
// interchangeable "backends": the soothing on-device AI voice and the phone's built-in voice.
// If the AI voice isn't ready or fails, the built-in voice takes over without a gap.

import { chunkForSpeech } from './text.js';
import { speechLocale } from './i18n.js';
import { rankSystemVoices, prepareForNeuralVoice, voiceProfile } from './voices.js';
import { getPiperVoice, SoothingPlayer } from './neuralVoice.js';
import { getSupertonicVoice, SupertonicVoice } from './supertonicVoice.js';

const WORDS_PER_MINUTE = 165;
const estimateMs = (text, rate) => Math.max(1200, ((text.split(/\s+/).length / WORDS_PER_MINUTE) * 60000) / rate);
const CALM_PITCH = 0.95; // built-in voices: a touch lower

/** The phone's built-in text-to-speech, using the calmest available voice. */
export class SystemBackend {
  kind = 'system';

  constructor({ lang, voiceName = null }) {
    this.synth = globalThis.speechSynthesis ?? null;
    this.lang = lang;
    this.voiceName = voiceName;
    this.voice = null;
    if (this.synth) {
      this.#pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.#pickVoice());
    }
  }

  get available() {
    return !!this.synth && this.synth.getVoices().length > 0;
  }

  get label() {
    return this.voice?.name ?? null;
  }

  #pickVoice() {
    const voices = this.synth.getVoices();
    this.voice =
      voices.find((v) => v.name === this.voiceName) ??
      rankSystemVoices(voices, this.lang, speechLocale(this.lang))[0] ??
      null;
  }

  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  speak(text, { rate }) {
    let timer;
    let resolveDone;
    const done = new Promise((resolve) => (resolveDone = resolve));
    const finish = () => {
      clearTimeout(timer);
      resolveDone();
    };
    if (this.available) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechLocale(this.lang);
      if (this.voice) u.voice = this.voice;
      u.rate = rate * 0.95;
      u.pitch = CALM_PITCH;
      u.onend = finish;
      u.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') finish();
      };
      this.synth.speak(u);
      timer = setTimeout(finish, estimateMs(text, rate) * 2 + 5000); // some engines never fire 'end'
    } else {
      timer = setTimeout(finish, estimateMs(text, rate)); // no voice installed: pace the transcript
    }
    return {
      done,
      cancel: () => {
        clearTimeout(timer);
        if (this.available) this.synth.cancel();
      },
    };
  }
}

/** The AI voice (Supertonic or Piper), synthesized on the device and played with a warm EQ. */
export class NeuralBackend {
  kind = 'neural';

  constructor({ lang, id, speaker = 0, style = null, label = null, profile = 'calm', tweak }) {
    this.lang = lang;
    this.label = label ?? id;
    this.profile = voiceProfile(profile, tweak);
    this.voice = id === 'supertonic-3' ? getSupertonicVoice(style ?? 'F1') : getPiperVoice(id, speaker);
    // What the text needs before this voice reads it (numbers in words, regnal numbers…).
    this.prepareText = this.voice instanceof SupertonicVoice ? (text) => SupertonicVoice.prepare(text, lang) : (text) => prepareForNeuralVoice(text, lang);
    this.player = new SoothingPlayer({ pitch: this.profile.pitch, eq: this.profile.eq });
    this.prepared = new Map(); // text -> Promise<audio>, so the next sentence is ready in time
  }

  load(onProgress) {
    return this.voice.load(onProgress);
  }

  get ready() {
    return this.voice.ready;
  }

  unlock() {
    this.player.unlock();
  }

  /** Start synthesizing ahead of time. */
  prepare(text, { rate }) {
    const key = `${rate}|${text}`;
    if (!this.prepared.has(key)) {
      const { pace, pitch, pause } = this.profile;
      // Played back at `pitch` speed, so synthesize a little faster to keep the overall pace.
      const promise = this.voice.synthesize(this.prepareText(text), { pace: (pace * pitch) / rate, pause, lang: this.lang });
      promise.catch(() => this.prepared.delete(key));
      this.prepared.set(key, promise);
      while (this.prepared.size > 8) this.prepared.delete(this.prepared.keys().next().value);
    }
    return this.prepared.get(key);
  }

  speak(text, { rate }) {
    let cancelled = false;
    const done = (async () => {
      const audio = await this.prepare(text, { rate });
      if (cancelled) return;
      const seconds = audio.samples.length / audio.sampleRate / this.profile.pitch;
      let timer;
      const watchdog = new Promise((resolve) => (timer = setTimeout(resolve, seconds * 1000 + 4000)));
      await Promise.race([this.player.play(audio), watchdog]);
      clearTimeout(timer);
    })();
    return {
      done,
      cancel: () => {
        cancelled = true;
        this.player.stop();
      },
    };
  }
}

export class Narrator {
  constructor({ lang = 'en', rate = 1, systemVoiceName = null, backend = null } = {}) {
    this.lang = lang;
    this.rate = rate;
    this.system = backend ?? new SystemBackend({ lang, voiceName: systemVoiceName });
    this.backend = this.system;
    this.neural = null;
    this.queue = [];
    this.current = null; // { text, meta, chunks, index }
    this.lastItem = null;
    this.paused = false;
    this.unlocked = false;
    this.token = null; // identifies the chunk currently being spoken
    this.handle = null;
    this.timer = null;
    this.listeners = {};
  }

  on(event, fn) {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event].delete(fn);
  }

  #emit(event, data) {
    for (const fn of this.listeners[event] ?? []) fn(data);
  }

  get busy() {
    return !!this.current || this.queue.length > 0;
  }

  /** True when a real voice will be heard (otherwise only the transcript is shown). */
  get hasVoice() {
    return this.backend.kind === 'neural' || !!this.system.available;
  }

  get voiceLabel() {
    return this.backend.label;
  }

  /** Call from a tap/click handler: mobile browsers only allow audio after a user gesture. */
  unlock() {
    this.unlocked = true;
    this.system.unlock?.();
    this.neural?.unlock();
  }

  /**
   * Switch to the soothing AI voice once it's loaded (downloading it the first time).
   * Until then, and if it fails, the built-in voice keeps talking.
   */
  async useNeuralVoice({ id, speaker = 0, style = null, label, profile, tweak }, onProgress) {
    const neural = new NeuralBackend({ lang: this.lang, id, speaker, style, label, profile, tweak });
    this.neural = neural;
    if (this.unlocked) neural.unlock();
    await neural.load(onProgress);
    if (this.neural !== neural) return false; // replaced meanwhile
    this.backend = neural;
    this.#emit('voice', { kind: 'neural', label: neural.label });
    // Warm up: synthesize what's coming next.
    const next = this.current?.text ?? this.queue[0]?.text;
    if (next) neural.prepare(this.#chunksFor(next)[0], { rate: this.rate });
    return true;
  }

  setRate(rate) {
    this.rate = rate;
  }

  /**
   * Queue something to say.
   * priority: jump ahead of normal items. interrupt: cut off what's being said now.
   */
  speak(text, meta = {}, { priority = false, interrupt = false } = {}) {
    if (!text) return;
    const item = { text, meta, priority, chunks: null, index: 0 };
    // Priority items go ahead of normal ones but stay in order among themselves.
    const at = priority ? this.queue.findIndex((queued) => !queued.priority) : -1;
    if (at === -1) this.queue.push(item);
    else this.queue.splice(at, 0, item);
    if (interrupt && this.current) {
      this.#cancelSpeech();
      this.current = null;
      this.#scheduleNext();
    } else if (!this.current && !this.paused) {
      this.#next();
    } else if (this.queue[0] === item) {
      this.backend.prepare?.(this.#chunksFor(text)[0], { rate: this.rate });
    }
  }

  /**
   * Say something short right now (a turn: "In 30 meters, turn left"). If a story is being
   * told, it pauses at the current sentence and carries on from there afterwards.
   */
  interject(text, meta = {}, { urgent = true } = {}) {
    if (!text) return;
    const item = { text, meta: { ...meta, interjection: true }, priority: true, chunks: null, index: 0 };
    // Replace any direction still waiting: only the latest one matters.
    this.queue = this.queue.filter((q) => !q.meta?.interjection);
    if (!urgent && this.current) {
      // Not time-critical ("head east"): say it as soon as the current story ends.
      this.queue.unshift(item);
    } else if (this.current && !this.current.meta?.interjection) {
      const story = this.current;
      this.#cancelSpeech();
      this.current = null;
      this.queue.unshift(item, story); // the story resumes at the sentence it was on
      if (!this.paused) this.#scheduleNext();
    } else {
      this.queue.unshift(item);
      if (!this.current && !this.paused) this.#next();
    }
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.#cancelSpeech(); // the current sentence restarts on resume (reliable on every browser)
    this.#emit('state', { paused: true });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.#emit('state', { paused: false });
    if (this.current) this.#speakChunk();
    else this.#next();
  }

  /** Stop the current story and move on to the next one. */
  skip() {
    if (!this.current) return;
    this.#cancelSpeech();
    this.#emit('end', this.current);
    this.current = null;
    if (!this.paused) this.#scheduleNext();
  }

  /** Say the current (or last) story again from the start. */
  repeat() {
    const item = this.current ?? this.lastItem;
    if (!item) return;
    const again = { ...item, index: 0, repeated: true };
    if (this.current) {
      this.#cancelSpeech();
      this.current = null;
    }
    this.queue.unshift(again);
    if (!this.paused) this.#scheduleNext();
  }

  stop() {
    this.queue = [];
    this.#cancelSpeech();
    this.current = null;
    this.paused = false;
    this.neural = null;
  }

  #chunksFor(text) {
    if (this.backend.kind !== 'neural') return chunkForSpeech(text, 220, this.lang);
    // Shorter pieces for the AI voice, and a short first one: the first words are heard sooner
    // (the voice makes speech at about real time on a slow phone).
    const chunks = chunkForSpeech(text, 160, this.lang);
    if (chunks[0]?.length > 90) chunks.splice(0, 1, ...chunkForSpeech(chunks[0], 90, this.lang));
    return chunks;
  }

  #scheduleNext() {
    // Some browsers drop an utterance spoken right after cancel(); give them a beat.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.#next(), 80);
  }

  #next() {
    if (this.paused || this.current) return;
    const item = this.queue.shift();
    if (!item) {
      this.#emit('idle');
      return;
    }
    item.chunks ??= this.#chunksFor(item.text);
    item.resumed = item.index > 0; // picking a story up again after a direction
    this.current = item;
    if (!item.meta?.interjection) this.lastItem = item;
    this.#emit('start', item);
    this.#speakChunk();
  }

  #speakChunk() {
    const item = this.current;
    if (!item || this.paused) return;
    if (item.index >= item.chunks.length) {
      this.current = null;
      this.#emit('end', item);
      this.#next();
      return;
    }
    const backend = this.backend;
    const text = item.chunks[item.index];
    const token = (this.token = Symbol('chunk'));
    this.handle = backend.speak(text, { rate: this.rate });

    // Get the next piece ready while this one plays.
    const upcoming = item.chunks[item.index + 1] ?? (this.queue[0] && this.#chunksFor(this.queue[0].text)[0]);
    if (upcoming) backend.prepare?.(upcoming, { rate: this.rate });

    this.handle.done.then(
      () => {
        if (this.token !== token) return;
        item.index++;
        this.#speakChunk();
      },
      (error) => {
        if (this.token !== token) return;
        if (backend.kind === 'neural') {
          // The AI voice failed (memory, network…): carry on with the built-in voice.
          this.backend = this.system;
          this.neural = null;
          this.#emit('voice', { kind: 'system', label: this.system.label, error });
        }
        this.#speakChunk();
      },
    );
  }

  #cancelSpeech() {
    this.token = null;
    clearTimeout(this.timer);
    this.handle?.cancel();
    this.handle = null;
  }
}
