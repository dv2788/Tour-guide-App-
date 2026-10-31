// The voice. Wraps the browser's built-in text-to-speech with a queue,
// pause/skip/repeat, and a silent "transcript only" fallback when no voice is available.

import { chunkForSpeech } from './text.js';
import { speechLocale } from './i18n.js';

const WORDS_PER_MINUTE = 165;
const estimateMs = (text, rate) => Math.max(1200, ((text.split(/\s+/).length / WORDS_PER_MINUTE) * 60000) / rate);

export class Narrator {
  constructor({ lang = 'en', rate = 1 } = {}) {
    this.synth = globalThis.speechSynthesis ?? null;
    this.lang = lang;
    this.rate = rate;
    this.voice = null;
    this.queue = [];
    this.current = null; // { text, meta, chunks, index }
    this.lastItem = null;
    this.paused = false;
    this.token = null; // identifies the chunk currently being spoken
    this.timer = null;
    this.listeners = {};
    if (this.synth) {
      this.#pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.#pickVoice());
    }
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
    return !!this.synth && this.synth.getVoices().length > 0;
  }

  /** Call from a tap/click handler: mobile browsers only allow speech after a user gesture. */
  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
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
    const item = { text, meta, priority, chunks: chunkForSpeech(text, 220, this.lang), index: 0 };
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
  }

  #pickVoice() {
    const voices = this.synth.getVoices();
    const locale = speechLocale(this.lang).toLowerCase();
    const lang = this.lang.toLowerCase();
    const matching = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith(lang));
    const score = (v) =>
      (v.lang.toLowerCase().replace('_', '-') === locale ? 4 : 0) +
      (/premium|enhanced|natural|neural|google/i.test(v.name) ? 2 : 0) +
      (v.localService ? 1 : 0);
    this.voice = matching.sort((a, b) => score(b) - score(a))[0] ?? null;
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
    this.current = item;
    this.lastItem = item;
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
    const text = item.chunks[item.index];
    const token = (this.token = Symbol('chunk'));
    let finished = false;
    const done = () => {
      if (finished || this.token !== token) return;
      finished = true;
      clearTimeout(this.timer);
      item.index++;
      this.#speakChunk();
    };

    if (this.hasVoice) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speechLocale(this.lang);
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate;
      u.onend = done;
      u.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') done();
      };
      this.synth.speak(u);
      // Watchdog: some engines occasionally never fire 'end'.
      this.timer = setTimeout(done, estimateMs(text, this.rate) * 2 + 5000);
    } else {
      // No voice installed: show the transcript and pace it like speech.
      this.timer = setTimeout(done, estimateMs(text, this.rate));
    }
  }

  #cancelSpeech() {
    this.token = null;
    clearTimeout(this.timer);
    if (this.synth) this.synth.cancel();
  }
}
