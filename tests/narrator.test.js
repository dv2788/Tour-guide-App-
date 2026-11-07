import test from 'node:test';
import assert from 'node:assert/strict';
import { Narrator } from '../js/narrator.js';
import { flush } from './helpers.js';

/** A voice we control: each spoken piece finishes when the test says so. */
function fakeVoice(kind = 'system', { fail = false } = {}) {
  const voice = {
    kind,
    label: kind,
    available: true,
    spoken: [],
    prepared: [],
    preparedWith: [],
    pending: [],
    speak(text) {
      voice.spoken.push(text);
      let finish;
      const done = fail ? Promise.reject(new Error('voice crashed')) : new Promise((r) => (finish = r));
      done.catch(() => {});
      const entry = { text, finish: () => finish?.(), cancelled: false };
      voice.pending.push(entry);
      return { done, cancel: () => (entry.cancelled = true) };
    },
    prepare(text, options = {}) {
      voice.prepared.push(text);
      voice.preparedWith.push(options);
    },
    /** Finish whatever is being said now. */
    async finishCurrent() {
      const entry = voice.pending.filter((e) => !e.cancelled).at(-1);
      entry?.finish();
      await flush();
    },
  };
  return voice;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('arrivals (priority) jump ahead of stories but keep their own order', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  n.speak('Welcome.');
  n.speak('Story A.');
  n.speak('Arrived 1.', {}, { priority: true });
  n.speak('Arrived 2.', {}, { priority: true });
  for (let i = 0; i < 4; i++) await voice.finishCurrent();
  assert.deepEqual(voice.spoken, ['Welcome.', 'Arrived 1.', 'Arrived 2.', 'Story A.']);
});

test('interrupt cuts off the current story', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  n.speak('A long story about a bridge.', { kind: 'poi' });
  n.speak('You have arrived.', { kind: 'stop' }, { priority: true, interrupt: true });
  await wait(120);
  assert.deepEqual(voice.spoken, ['A long story about a bridge.', 'You have arrived.']);
  assert.equal(voice.pending[0].cancelled, true);
  assert.equal(n.current.meta.kind, 'stop');
});

test('pause stops the voice; resume restarts the sentence; idle fires when done', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  let idle = 0;
  n.on('idle', () => idle++);
  n.speak('First sentence. Second sentence.');
  n.pause();
  assert.equal(voice.pending[0].cancelled, true);
  n.resume();
  assert.deepEqual(voice.spoken, ['First sentence. Second sentence.', 'First sentence. Second sentence.']);
  await voice.finishCurrent();
  assert.equal(idle, 1);
  assert.equal(n.busy, false);
});

test('the next piece is prepared while the current one plays', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  n.speak('One.');
  n.speak('Two.');
  assert.deepEqual(voice.prepared, ['Two.']);
});

test('if the AI voice fails, the built-in voice carries on with the same sentence', async () => {
  const builtIn = fakeVoice('system');
  const n = new Narrator({ backend: builtIn });
  const events = [];
  n.on('voice', (e) => events.push(e.kind));
  n.backend = fakeVoice('neural', { fail: true });
  n.speak('Hello there.');
  await flush();
  await flush();
  assert.deepEqual(builtIn.spoken, ['Hello there.']);
  assert.deepEqual(events, ['system']);
  assert.equal(n.backend, builtIn);
});

test('repeat says the last story again', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  n.speak('A story.');
  await voice.finishCurrent();
  n.repeat();
  await wait(120);
  assert.deepEqual(voice.spoken, ['A story.', 'A story.']);
  assert.equal(n.current.repeated, true);
});

test('a direction interrupts a story briefly, then the story carries on where it was', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  const starts = [];
  n.on('start', (item) => starts.push({ text: item.text.slice(0, 12), resumed: item.resumed, direction: !!item.meta.interjection }));
  n.speak('First sentence of the story. Second sentence of the story.', { kind: 'poi' });
  // Make the story two pieces long so we can interrupt after the first.
  n.current.chunks = ['First sentence of the story.', 'Second sentence of the story.'];
  n.current.index = 1;
  n.interject('In 30 meters, turn left.', { kind: 'direction' });
  await wait(120);
  assert.equal(voice.spoken.at(-1), 'In 30 meters, turn left.');
  await voice.finishCurrent();
  assert.equal(voice.spoken.at(-1), 'Second sentence of the story.', 'resumes at the same sentence');
  assert.deepEqual(starts.map((s) => [s.direction, s.resumed]), [[false, false], [true, false], [false, true]]);
  // Repeat still means the story, not the direction.
  assert.match(n.lastItem.text, /^First sentence/);
});

test('only the latest waiting direction is kept', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  n.speak('Welcome.');
  n.pause();
  n.interject('Turn left.');
  n.interject('Turn right.');
  assert.deepEqual(n.queue.filter((q) => q.meta.interjection).map((q) => q.text), ['Turn right.']);
});

test('a non-urgent direction waits for the end of the story', async () => {
  const voice = fakeVoice();
  const n = new Narrator({ backend: voice });
  n.speak('You have arrived at the Louvre. A long story.', { kind: 'stop' });
  n.interject('Head east onto Rue de Rivoli.', { kind: 'direction' }, { urgent: false });
  assert.equal(voice.pending[0].cancelled, false, 'the story is not cut off');
  await voice.finishCurrent();
  assert.equal(voice.spoken.at(-1), 'Head east onto Rue de Rivoli.');
});

test('an AI voice that never finishes a sentence is given up on, and the built-in voice takes over', async () => {
  const { NeuralBackend } = await import('../js/narrator.js');
  const ai = new NeuralBackend({ lang: 'en', id: 'supertonic-3' });
  ai.voice = { ready: true, synthesize: () => new Promise(() => {}) }; // stalls forever
  ai.player = { play: async () => {}, stop() {} };
  ai.budgetMs = () => 30;
  const builtIn = fakeVoice('system');
  const n = new Narrator({ backend: builtIn });
  const events = [];
  n.on('voice', (e) => events.push(`${e.kind}:${e.error?.message ?? ''}`));
  n.backend = ai;
  n.speak('Hello there.');
  await wait(80);
  assert.deepEqual(builtIn.spoken, ['Hello there.']);
  assert.deepEqual(events, ['system:synthesis timed out']);
  assert.equal(ai.prepared.size, 0, 'the stuck promise is dropped');
});

test('priming gets the first two pieces ready at full quality; only the AI voice is primed', () => {
  const voice = fakeVoice('neural');
  const n = new Narrator({ backend: voice });
  const sentence = (i) => `Sentence number ${i} is about seventy characters long so the chunker splits it off.`;
  n.prime([1, 2, 3, 4].map(sentence).join(' '));
  assert.equal(voice.prepared.length, 2, 'a short first piece, then the next one');
  assert.equal(voice.prepared[0], sentence(1));
  assert.ok(voice.preparedWith.every((o) => o.unhurried === true));
  const builtIn = fakeVoice('system');
  new Narrator({ backend: builtIn }).prime('One. Two.');
  assert.deepEqual(builtIn.prepared, []);
});
