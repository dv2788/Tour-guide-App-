// Test doubles for the narrator and Wikipedia.

export class FakeNarrator {
  constructor() {
    this.spoken = []; // every speak() call, in order
    this.primed = []; // every prime() call
    this.queue = [];
    this.current = null;
    this.listeners = {};
  }
  on(event, fn) {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event].delete(fn);
  }
  get busy() {
    return !!this.current || this.queue.length > 0;
  }
  prime(text) {
    this.primed.push(text);
  }
  speak(text, meta = {}, options = {}) {
    const item = { text, meta, options };
    this.spoken.push(item);
    if (options.interrupt) this.current = null;
    const at = options.priority ? this.queue.findIndex((q) => !q.options.priority) : -1;
    if (at === -1) this.queue.push(item);
    else this.queue.splice(at, 0, item);
    if (!this.current) this.current = this.queue.shift();
  }
  /** Pretend everything queued has been said. */
  finishAll() {
    if (!this.busy) return;
    this.queue = [];
    this.current = null;
    for (const fn of this.listeners.idle ?? []) fn();
  }
}

export function fakeWiki({ pois = [], summaries = {}, articles = {} } = {}) {
  const calls = { nearby: 0 };
  return {
    calls,
    async nearby() {
      calls.nearby++;
      return pois;
    },
    async summary(title) {
      if (summaries[title]) return summaries[title];
      throw new Error(`no summary for ${title}`);
    },
    async resolveArticle(place) {
      return articles[place.name] ?? null;
    },
  };
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));
