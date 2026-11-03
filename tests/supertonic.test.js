import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocess, textToIds, chunkText, gaussian, seeded, SupertonicVoice, SUPERTONIC_FILES, SUPERTONIC_LANGS, MIN_STEPS, MAX_STEPS } from '../js/supertonicVoice.js';
import { NEURAL_VOICES, neuralVoiceKey, parseVoiceKey, defaultVoiceKey, PREVIEW_TEXT } from '../js/voices.js';
import { isFreeVoice, freeVoice } from '../js/plus.js';
import { readFileSync, statSync } from 'node:fs';

test('text is cleaned the way the model expects, then tagged with its language', () => {
  assert.equal(preprocess('Hello – world', 'en'), '<en>Hello - world.</en>');
  assert.equal(preprocess('“Casa Batlló” , said he!', 'es'), '<es>"Casa Batlló", said he!</es>'.normalize('NFKD'));
  assert.equal(preprocess('Bonjour 😊 tout le monde', 'fr'), '<fr>Bonjour tout le monde.</fr>');
  assert.equal(preprocess('  spaced   out  ', 'it'), '<it>spaced out.</it>');
  assert.ok(preprocess('café', 'fr').includes('café'), 'accents are decomposed (NFKD), as in training');
});

test('characters become the model indices; unknown characters are left out', () => {
  const indexer = new Array(200).fill(-1);
  indexer['a'.charCodeAt(0)] = 1;
  indexer['b'.charCodeAt(0)] = 2;
  indexer[' '.charCodeAt(0)] = 3;
  assert.deepEqual(textToIds('ab ba', indexer), [1, 2, 3, 2, 1]);
  assert.deepEqual(textToIds('a✓b', indexer), [1, 2], 'a character the model never saw is skipped');
  assert.deepEqual(textToIds('a😀b', indexer), [1, 2], 'and so is one beyond the table');
});

test('the shipped character table covers the five languages and the language tags', () => {
  const indexer = JSON.parse(readFileSync(new URL('../voices/supertonic-3/unicode_indexer.json', import.meta.url), 'utf8'));
  const sample = "<en></fr><es><de><it>AZaz09 .,;:!?'\"()-àâçéèêëîïôûùüÿñáíóúäöß";
  for (const ch of preprocess(sample, 'en')) assert.ok(indexer[ch.codePointAt(0)] >= 0, `the model knows "${ch}"`);
  for (const lang of ['en', 'fr', 'es', 'de', 'it']) {
    assert.ok(SUPERTONIC_LANGS.includes(lang));
    const ids = textToIds(preprocess(PREVIEW_TEXT[lang], lang), indexer);
    assert.ok(ids.length > PREVIEW_TEXT[lang].length * 0.95, `${lang}: nearly every character of the preview sentence is known`);
  }
});

test('long text is cut at sentence ends into pieces the model takes in one go', () => {
  const sentence = 'This is a sentence that goes on for a while. ';
  const chunks = chunkText(sentence.repeat(10), 120);
  assert.ok(chunks.length >= 4);
  for (const c of chunks) {
    assert.ok(c.length <= 120, `≤ 120 chars: ${c.length}`);
    assert.ok(c.endsWith('.'), 'ends at a sentence end');
  }
  assert.deepEqual(chunkText('Dr. Smith arrived. He sat down.', 300), ['Dr. Smith arrived. He sat down.']);
  assert.deepEqual(chunkText('One.\n\nTwo.', 300), ['One.', 'Two.'], 'paragraphs stay apart');
});

test('the noise is standard normal, and repeatable with a seed', () => {
  const a = gaussian(20000, seeded(42));
  const b = gaussian(20000, seeded(42));
  assert.deepEqual(a, b);
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const std = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
  assert.ok(Math.abs(mean) < 0.03, `mean ≈ 0 (${mean})`);
  assert.ok(Math.abs(std - 1) < 0.03, `std ≈ 1 (${std})`);
  assert.notDeepEqual(gaussian(16, seeded(1)), gaussian(16, seeded(2)));
});

test('the number of refinement steps follows the phone speed', () => {
  const voice = new SupertonicVoice('F1');
  assert.equal(voice.stepsFor(), 4, 'a careful start before the speed is known');
  voice.cost = { fixed: 0.08, step: 0.07 }; // a fast phone
  assert.equal(voice.stepsFor(), MAX_STEPS);
  voice.cost = { fixed: 0.25, step: 0.2 }; // a slow one
  assert.equal(voice.stepsFor(), MIN_STEPS);
  voice.cost = { fixed: 0.15, step: 0.12 };
  assert.equal(voice.stepsFor(), 5);
  assert.equal(new SupertonicVoice('F1', { steps: 6 }).stepsFor(), 6, 'a fixed count stays fixed');
});

test('the published model files are the ones the app checks for', () => {
  for (const [name, { size }] of Object.entries(SUPERTONIC_FILES)) {
    assert.equal(statSync(new URL(`../voices/supertonic-3/${name}`, import.meta.url)).size, size, `${name} size`);
  }
  const styles = JSON.parse(readFileSync(new URL('../voices/supertonic-3/voices/styles.json', import.meta.url), 'utf8'));
  for (const v of Object.values(NEURAL_VOICES).flat().filter((v) => v.id === 'supertonic-3')) {
    assert.ok(styles[v.style], `style ${v.style} exists`);
    const bytes = statSync(new URL(`../voices/supertonic-3/voices/${v.style}.bin`, import.meta.url)).size;
    const floats = [styles[v.style].ttl, styles[v.style].dp].reduce((n, dims) => n + dims.reduce((a, b) => a * b, 1), 0);
    assert.equal(bytes, floats * 4, `${v.style}.bin holds exactly its two tensors`);
  }
});

test('voice keys: the new voice is the default and free in every language; old keys still parse', () => {
  for (const lang of ['en', 'fr', 'es', 'de', 'it']) {
    assert.equal(defaultVoiceKey(lang), 'neural:supertonic-3:F1');
    assert.equal(freeVoice(lang).label, 'Nora');
    assert.equal(isFreeVoice(lang, 'neural:supertonic-3:F1'), true);
    assert.equal(isFreeVoice(lang, 'neural:supertonic-3:M2'), false);
    assert.ok(NEURAL_VOICES[lang].some((v) => v.profile === 'documentary' && v.id === 'supertonic-3'), `${lang} has the narrator`);
  }
  assert.deepEqual(parseVoiceKey('neural:supertonic-3:F1'), { kind: 'neural', id: 'supertonic-3', speaker: 0, style: 'F1' });
  assert.deepEqual(parseVoiceKey('neural:en_GB-vctk-medium:10'), { kind: 'neural', id: 'en_GB-vctk-medium', speaker: 10 });
  assert.deepEqual(parseVoiceKey('neural:en_GB-jenny_dioco-medium:0'), { kind: 'neural', id: 'en_GB-jenny_dioco-medium', speaker: 0 });
  for (const v of Object.values(NEURAL_VOICES).flat()) assert.equal(neuralVoiceKey(parseVoiceKey(neuralVoiceKey(v))), neuralVoiceKey(v), 'round trip');
});
