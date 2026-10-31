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

test('voices: calm built-in voices ranked first, novelty voices never', async () => {
  const { rankSystemVoices, prepareForNeuralVoice, parseVoiceKey, defaultVoiceKey } = await import('../js/voices.js');
  const voices = [
    { name: 'Zarvox', lang: 'en-US', localService: true },
    { name: 'Fred', lang: 'en-US', localService: true },
    { name: 'Google US English', lang: 'en-US', localService: false },
    { name: 'Ava (Premium)', lang: 'en-US', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: true },
    { name: 'Thomas', lang: 'fr-FR', localService: true },
  ];
  const ranked = rankSystemVoices(voices, 'en', 'en-US').map((v) => v.name);
  assert.deepEqual(ranked.slice(0, 3), ['Ava (Premium)', 'Samantha', 'Google US English']);
  assert.ok(ranked.indexOf('Zarvox') > ranked.indexOf('Google US English'));
  assert.ok(!ranked.includes('Thomas'));

  assert.equal(prepareForNeuralVoice('Sur votre gauche : le pont Alexandre-III, voulu par Louis XIV.', 'fr'), 'Sur votre gauche : le pont Alexandre 3, voulu par Louis 14.');
  assert.equal(prepareForNeuralVoice('Ludwig XIV. baute Saint-Louis.', 'de'), 'Ludwig 14. baute Saint-Louis.');
  assert.equal(prepareForNeuralVoice('Louis XIV', 'en'), 'Louis XIV', 'English voices read numerals correctly');

  assert.deepEqual(parseVoiceKey('neural:es_ES-sharvard-medium:1'), { kind: 'neural', id: 'es_ES-sharvard-medium', speaker: 1 });
  assert.deepEqual(parseVoiceKey('system:Ava (Premium)'), { kind: 'system', name: 'Ava (Premium)' });
  assert.equal(defaultVoiceKey('fr'), 'neural:fr_FR-siwis-medium:0');
});

test('documentary narration phrases, with standard fallbacks', async () => {
  const { buildPoiNarration } = await import('../js/narration.js');
  const { getMode } = await import('../js/modes.js');
  const summary = { extract: 'A palace (1900). It is grand. It is old.' };
  assert.equal(
    buildPoiNarration({ lang: 'en', mode: getMode('walk'), title: 'Grand Palais', summary, direction: 'left', distance: 50, style: 'documentary' }),
    'And here, on your left… Grand Palais. A palace. It is grand. It is old.',
  );
  assert.equal(
    buildPoiNarration({ lang: 'fr', mode: getMode('drive'), title: 'Grand Palais', summary, direction: 'right', distance: 300, style: 'documentary' }),
    'Et là, sur votre droite, dans 300 mètres… Grand Palais. A palace. It is grand.',
  );
  // Italian has no narrator phrasing: standard phrases are used.
  assert.equal(t('it', 'left', {}, 'documentary'), 'Alla tua sinistra');
});
