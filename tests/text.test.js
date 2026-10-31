import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanForSpeech, firstSentences, chunkForSpeech, classifyPlace, sharesNameToken } from '../js/text.js';
import { formatDistance, t } from '../js/i18n.js';

test('cleanForSpeech drops pronunciations, nested parentheses and citations', () => {
  const raw =
    'The Eiffel Tower (/ˈaɪfəl/ EYE-fəl; French: tour Eiffel [tuʁ ɛfɛl] (listen)) is a wrought-iron lattice tower[1] on the Champ de Mars .';
  assert.equal(cleanForSpeech(raw), 'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars.');
});

test('firstSentences keeps decimals intact', () => {
  const text = 'It is 330 m tall. It was built in 1889 for 7.8 million francs. It has three levels. Lifts go up.';
  assert.equal(firstSentences(text, 2), 'It is 330 m tall. It was built in 1889 for 7.8 million francs.');
});

test('chunkForSpeech keeps chunks short without losing words', () => {
  const sentence = 'word '.repeat(120).trim() + '.';
  const text = `Short one. ${sentence} Another short one.`;
  const chunks = chunkForSpeech(text, 100);
  assert.ok(chunks.every((c) => c.length <= 100), chunks.map((c) => c.length).join(','));
  assert.equal(chunks.join(' ').split(/\s+/).length, text.split(/\s+/).length);
});

test('classifyPlace skips metro stations and lists, demotes streets', () => {
  assert.equal(classifyPlace({ title: 'Bir-Hakeim', description: 'Paris Métro station' }), 'skip');
  assert.equal(classifyPlace({ title: 'Trocadéro', description: 'metro station in Paris, France' }), 'skip');
  assert.equal(classifyPlace({ title: 'List of bridges in Paris' }), 'skip');
  assert.equal(classifyPlace({ title: 'Mercury', disambiguation: true }), 'skip');
  assert.equal(classifyPlace({ title: 'Avenue Rapp', description: 'street in Paris, France' }), 'minor');
  assert.equal(classifyPlace({ title: "Pont de l'Alma station", description: 'railway station in Paris' }), 'minor');
  assert.equal(classifyPlace({ title: 'Musée du quai Branly', description: 'museum in Paris, France' }), null);
});

test('sharesNameToken ignores accents and filler words', () => {
  assert.ok(sharesNameToken('Musée du Louvre', 'Louvre'));
  assert.ok(sharesNameToken("Pont de l'Alma", 'Pont de l’Alma'));
  assert.ok(!sharesNameToken('Museum of Paris', 'Museum of London'));
});

test('formatDistance rounds for listening, per language', () => {
  assert.equal(formatDistance('en', 37), '40 meters');
  assert.equal(formatDistance('en', 333), '350 meters');
  assert.equal(formatDistance('en', 990), '1 kilometer');
  assert.equal(formatDistance('en', 1240), '1.2 kilometers');
  assert.equal(formatDistance('fr', 1240), '1,2 kilomètres');
  assert.equal(formatDistance('de', 25000), '25 Kilometer');
});

test('t falls back to English and fills placeholders', () => {
  assert.equal(t('fr', 'arrived', { name: 'Louvre' }), 'Vous voici à Louvre.');
  assert.equal(t('xx', 'arrived', { name: 'Louvre' }), 'You have arrived at Louvre.');
});
