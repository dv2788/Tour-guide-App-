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
    prepare(text) {
      voice.prepared.push(text);
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
