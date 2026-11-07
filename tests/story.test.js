import test from 'node:test';
import assert from 'node:assert/strict';
import { expandForSpeech, dropCountryTails, storySentences, spokenSentences, splitDefinition, mergeDefinition, spokenName, contractArticles, polish, plainTitle } from '../js/story.js';
import { buildArrivalNarration, buildPoiNarration, buildWelcomeNarration, placeName } from '../js/narration.js';
import { MODES } from '../js/modes.js';

test('ranges, dashes, "&" and abbreviations are said the way they are read', () => {
  assert.equal(expandForSpeech('Built 1329–1383 by St. Eulalia & co., c. 1400 — a marvel.', 'en'), 'Built 1329 to 1383 by Saint Eulalia and co., around 1400, a marvel.');
  assert.equal(expandForSpeech('Bâtie de 1329-1383 près de St-Michel', 'fr'), 'Bâtie de 1329 à 1383 près de Saint-Michel');
  assert.equal(expandForSpeech('Erbaut 1329–1383, Nr. 5, z. B. am St. Petersplatz, 14. Jh.', 'de'), 'Erbaut 1329 bis 1383, Nummer 5, zum Beispiel am Sankt Petersplatz, 14. Jahrhundert');
  assert.equal(expandForSpeech('en el s. XIV, n.º 3', 'es'), 'en el siglo XIV, número 3');
  assert.equal(expandForSpeech('nel sec. XIV, n. 3', 'it'), 'nel secolo XIV, numero 3');
  assert.equal(expandForSpeech('A 2-3 minute walk', 'en'), 'A 2-3 minute walk', 'a short hyphenated range is not a year range');
});

test('country tails are dropped after a place, in every language, but never a country in a list', () => {
  assert.equal(
    dropCountryTails('Santa Maria del Mar is a church in the Ribera district of Barcelona, Catalonia, Spain, built between 1329 and 1383.', 'en'),
    'Santa Maria del Mar is a church in the Ribera district of Barcelona, built between 1329 and 1383.',
  );
  assert.equal(dropCountryTails('Casa Batlló is a building in the center of Barcelona, Spain.', 'en'), 'Casa Batlló is a building in the center of Barcelona.');
  assert.equal(dropCountryTails('It lies between Spain, France and Andorra.', 'en'), 'It lies between Spain, France and Andorra.');
  assert.equal(dropCountryTails('La place de Catalogne est une des principales places de Barcelone, en Espagne.', 'fr'), 'La place de Catalogne est une des principales places de Barcelone.');
  assert.equal(dropCountryTails('Es una basílica menor situada en la ciudad de Barcelona, Cataluña, España.', 'es'), 'Es una basílica menor situada en la ciudad de Barcelona.');
  assert.equal(dropCountryTails('Die Casa Batlló ist ein Gebäude in Barcelona, Spanien.', 'de'), 'Die Casa Batlló ist ein Gebäude in Barcelona.');
  assert.equal(dropCountryTails('È una chiesa di Barcellona, in Spagna.', 'it'), 'È una chiesa di Barcellona.');
  assert.equal(dropCountryTails('The Eiffel Tower is in Paris, France.', 'xx'), 'The Eiffel Tower is in Paris.', 'an unknown language falls back to English names');
});

test('the sentences worth hearing: statistics and administrative geography skipped, list-like sentences too', () => {
  const city =
    'Barcelona is a city on the northeastern coast of Spain. It is the capital and largest city of the autonomous community of Catalonia, as well as the second-most populous municipality of Spain after Madrid. With a population of 1.6 million within city limits, its urban area extends to numerous neighbouring municipalities.\nBarcelona is one of the largest metropolises on the Mediterranean Sea. Founded as a Roman city, in the Middle Ages Barcelona became the capital of the County of Barcelona.';
  assert.deepEqual(storySentences(city, { count: 3, lang: 'en' }), [
    'Barcelona is a city on the northeastern coast of Spain.',
    'Barcelona is one of the largest metropolises on the Mediterranean Sea.',
    'Founded as a Roman city, in the Middle Ages Barcelona became the capital of the County of Barcelona.',
  ]);
  const long = `The square is lined with ${'the house of someone, '.repeat(20)}and more.`;
  assert.deepEqual(storySentences(`${long} It is lovely at night.`, { count: 2, lang: 'en' }), ['It is lovely at night.'], 'a list of names is skipped when something else follows');
  assert.deepEqual(storySentences(long, { count: 2, lang: 'en' }), [long], 'but kept when it is all there is');
  assert.deepEqual(storySentences('Mit 1,7 Millionen Einwohnern ist sie groß. Die Altstadt ist sehenswert.', { count: 2, lang: 'de' }), ['Die Altstadt ist sehenswert.']);
  assert.equal(storySentences('A. B. C. D. E. F.', { count: 6, maxChars: 8, lang: 'en' }).length, 4, 'about maxChars in all');
  assert.deepEqual(storySentences('', { lang: 'en' }), []);
});

test('a definition sentence splits into the thing and what it is, in five languages', () => {
  assert.deepEqual(splitDefinition('Casa Batlló is a building in the center of Barcelona.', 'en'), { subject: 'Casa Batlló', name: 'Casa Batlló', tail: 'a building in the center of Barcelona', present: true });
  assert.equal(splitDefinition('The Cathedral of the Holy Cross and Saint Eulalia, also known as Barcelona Cathedral, is the seat of the archbishop of Barcelona.', 'en').name, 'The Cathedral of the Holy Cross and Saint Eulalia');
  assert.equal(splitDefinition('La Casa Batlló est un édifice moderniste conçu par Antoni Gaudí.', 'fr').tail, 'un édifice moderniste conçu par Antoni Gaudí');
  assert.equal(splitDefinition('La plaza de Cataluña es una céntrica plaza de Barcelona.', 'es').tail, 'una céntrica plaza de Barcelona');
  assert.equal(splitDefinition('Die Casa Batlló ist ein von Antoni Gaudí gestaltetes Gebäude.', 'de').tail, 'ein von Antoni Gaudí gestaltetes Gebäude');
  assert.equal(splitDefinition('Casa Batlló è un edificio modernista di Barcellona.', 'it').tail, 'un edificio modernista di Barcellona');
  assert.equal(splitDefinition('The palace was a residence of the kings.', 'en').present, false, 'past tense is noted');
  assert.equal(splitDefinition('It is located on La Rambla.', 'en'), null, 'no noun phrase after the copula');
  assert.equal(splitDefinition('Nobody knows what it is for.', 'en'), null, 'the copula comes too late');
});

test('the definition folds into the phrase that names the place, German after a colon', () => {
  assert.equal(mergeDefinition('You have arrived at Casa Batlló.', 'Casa Batlló is a building in the center of Barcelona.', 'Casa Batlló', 'en'), 'You have arrived at Casa Batlló, a building in the center of Barcelona.');
  assert.equal(mergeDefinition('And so, we arrive at Casa Batlló.', 'Casa Batlló is a building in the center of Barcelona.', 'Casa Batlló', 'en'), 'And so, we arrive at Casa Batlló, a building in the center of Barcelona.');
  assert.equal(mergeDefinition('On your left: Casa Batlló.', 'Casa Batlló is a building.', 'Casa Batlló', 'en'), 'On your left: Casa Batlló, a building.');
  assert.equal(mergeDefinition('Vous voici à la place de Catalogne.', 'La place de Catalogne est une des principales places de Barcelone.', 'la place de Catalogne', 'fr'), 'Vous voici à la place de Catalogne, une des principales places de Barcelone.');
  assert.equal(mergeDefinition('Sie sind bei Casa Batlló angekommen.', 'Die Casa Batlló ist ein von Antoni Gaudí gestaltetes Gebäude in Barcelona.', 'Casa Batlló', 'de'), 'Sie sind bei Casa Batlló angekommen: ein von Antoni Gaudí gestaltetes Gebäude in Barcelona.');
  assert.equal(mergeDefinition('Welcome to Barcelona. Let us take a closer look.', 'Barcelona is a city on the coast.', 'Barcelona', 'en'), null, 'only when the phrase ends with the name');
  assert.equal(mergeDefinition('You have arrived at the Royal Palace.', 'The Royal Palace was the home of the kings.', 'the Royal Palace', 'en'), null, 'not a past-tense definition');
});

test('a stop is named the way the language names it: the article when the traveller’s name is a translation', () => {
  const fr = { title: 'Cathédrale Sainte-Croix de Barcelone', extract: "La cathédrale basilique métropolitaine de la Sainte-Croix et de Sainte Eulalie de Barcelone, souvent surnommée Seu en catalan, est la cathédrale de l'archidiocèse catholique de Barcelone." };
  assert.equal(placeName('Barcelona Cathedral', fr, 'fr', { city: 'Barcelona' }), 'la Cathédrale Sainte-Croix de Barcelone');
  assert.equal(placeName('Plaça de Catalunya', { title: 'Place de Catalogne (Barcelone)', extract: 'La place de Catalogne est une des principales places de Barcelone, en Espagne.' }, 'fr'), 'la place de Catalogne');
  assert.equal(placeName('Santa Maria del Mar', { title: 'Basilique Sainte-Marie-de-la-Mer de Barcelone', extract: 'La basilique Sainte-Marie-de-la-Mer est une église de Barcelone en Catalogne.' }, 'fr'), 'la basilique Sainte-Marie-de-la-Mer');
  assert.equal(placeName('Casa Batlló', { title: 'Casa Batlló', extract: 'La Casa Batlló est un édifice moderniste.' }, 'fr'), 'la Casa Batlló', 'the same name, with the article its kind takes');
  assert.equal(placeName('Barcelona Cathedral', { title: 'Kathedrale von Barcelona', extract: 'Die Kathedrale von Barcelona ist eine gotische Kathedrale.' }, 'de', { city: 'Barcelona' }), 'die Kathedrale von Barcelona');
  assert.equal(placeName('Barcelona Cathedral', { title: 'Catedral de la Santa Cruz y Santa Eulalia (Barcelona)', extract: 'La Catedral Basílica Metropolitana de la Santa Cruz y Santa Eulalia —también llamada Seo— es la catedral gótica de Barcelona.' }, 'es', { city: 'Barcelona' }), 'la Catedral de la Santa Cruz y Santa Eulalia');
  assert.equal(placeName('Barcelona Cathedral', { title: 'Cattedrale di Barcellona', extract: 'La cattedrale di Barcellona è la chiesa principale della città.' }, 'it', { city: 'Barcelona' }), 'la cattedrale di Barcellona');
  assert.equal(placeName('Plaça Reial', { title: 'Royal Square (Barcelona)', extract: 'The Royal Square is a square in the Barri Gòtic.' }, 'en'), 'the Plaça Reial', 'English keeps the name on the signs, with "the" where English puts one');
  assert.equal(placeName('Eiffel Tower', { title: 'Eiffel Tower' }, 'en'), 'the Eiffel Tower');
  assert.equal(placeName('Louvre Museum', { title: 'Louvre' }, 'en'), 'the Louvre Museum');
  assert.equal(placeName('Place de la Concorde', { title: 'Place de la Concorde' }, 'en'), 'the Place de la Concorde');
  assert.equal(placeName('Casa Batlló', { title: 'Casa Batlló' }, 'en'), 'Casa Batlló');
  assert.equal(placeName('Jemaa el-Fna', { title: 'Jemaa el-Fnaa' }, 'en'), 'Jemaa el-Fna');
  assert.equal(placeName('Sumida Park', { title: 'Sumida Park' }, 'en'), 'Sumida Park');
  assert.equal(placeName("Saint Paul's Cathedral", { title: "St Paul's Cathedral" }, 'en'), "Saint Paul's Cathedral");
  assert.equal(placeName('Louvre Museum', { title: 'Musée du Louvre', extract: 'Le musée du Louvre est un musée parisien situé au sein du palais du Louvre.' }, 'fr'), 'le musée du Louvre');
  assert.equal(placeName('Saadian Tombs', { title: 'Tombeaux saadiens', extract: 'Les Tombeaux saadiens sont une nécropole royale historique à Marrakech, au Maroc.' }, 'fr'), 'les Tombeaux saadiens');
  assert.equal(placeName('Barcelona', { title: 'Barcelone', extract: 'Barcelone est la capitale de la Catalogne.' }, 'fr', { preferTitle: true }), 'Barcelone');
  assert.equal(placeName('Brussels', { title: 'Ville de Bruxelles', extract: 'La Ville de Bruxelles est une commune.' }, 'fr', { preferTitle: true }), 'Bruxelles');
  // The article's own words when the traveller's name has none: "à Louvre" is no French.
  assert.equal(spokenName('Louvre', { title: 'Musée du Louvre', firstSentence: 'Le musée du Louvre est un musée situé à Paris.' }, 'fr'), 'le musée du Louvre');
  assert.equal(
    spokenName('Grand Palais', { title: 'Grand Palais', firstSentence: 'Le Grand Palais des Champs-Élysées, plus communément appelé Grand Palais, est un monument parisien.' }, 'fr'),
    'le Grand Palais',
  );
  assert.equal(spokenName('Opéra Garnier', { title: 'Opéra Garnier', firstSentence: "L'opéra Garnier, ou palais Garnier, est un théâtre national." }, 'fr'), "l'Opéra Garnier");
  assert.equal(spokenName('Louvre', { title: 'Louvre', firstSentence: 'The Louvre, or the Louvre Museum, is a national art museum in Paris.' }, 'en'), 'the Louvre');
  assert.equal(spokenName('Arena di Verona', { title: 'Arena di Verona', firstSentence: "L'Arena di Verona è un anfiteatro romano." }, 'it'), "l'Arena di Verona");
  assert.equal(spokenName('Retiro', { title: 'Parque del Retiro', firstSentence: 'El Parque del Retiro, popularmente conocido como el Retiro, es un parque público de Madrid.' }, 'es'), 'el Parque del Retiro');
  assert.equal(spokenName('Montmartre', { title: 'Montmartre', firstSentence: 'Montmartre est une colline du nord de Paris.' }, 'fr'), 'Montmartre');
  assert.equal(spokenName('Grand Palais', { title: 'Grand Palais', firstSentence: 'Das Grand Palais ist ein Ausstellungsgebäude in Paris.' }, 'de'), 'Grand Palais'); // German cases: left alone
  assert.equal(plainTitle('Royal Square (Barcelona)'), 'Royal Square');
});

test('articles contract after "à", "a", "bei"', () => {
  assert.equal(contractArticles('Vous voici à le marché de la Boqueria', 'fr'), 'Vous voici au marché de la Boqueria');
  assert.equal(contractArticles('Has llegado a el palacio', 'es'), 'Has llegado al palacio');
  assert.equal(contractArticles("Eccoti a la cattedrale e a l'arco", 'it'), "Eccoti alla cattedrale e all'arco");
  assert.equal(contractArticles('Sie sind bei die Kathedrale angekommen', 'de'), 'Sie sind bei der Kathedrale angekommen');
  assert.equal(contractArticles('Sie sind bei der Dom angekommen', 'de'), 'Sie sind beim Dom angekommen');
  assert.equal(contractArticles('Sie sind bei das Museum angekommen', 'de'), 'Sie sind beim Museum angekommen');
});

const walk = MODES.walk;
const casa = { title: 'Casa Batlló', extract: "Casa Batlló is a building in the center of Barcelona, Spain. It was designed by Antoni Gaudí, and is considered one of his masterpieces. A remodel of a previously built house, it was redesigned in 1904 by Gaudí and has been refurbished several times since. Gaudí's assistants Domènec Sugrañes i Gras, Josep Canaleta and Joan Rubió also contributed to the renovation project." };

test('what the guide says on arrival: the definition folded in, no country tail, the lead section when there is one', () => {
  const text = buildArrivalNarration({ lang: 'en', mode: walk, stopName: 'Casa Batlló', summary: casa, nextStopName: 'Plaça de Catalunya', nextDistance: 400, style: 'standard', stayMinutes: 10 });
  assert.ok(text.startsWith('You have arrived at Casa Batlló, a building in the center of Barcelona. It was designed by Antoni Gaudí, and is considered one of his masterpieces.'), text);
  assert.ok(text.endsWith('Next stop: Plaça de Catalunya, 400 meters away.'), text);
  const lead = { text: `${casa.extract}\nThe building looks very remarkable: the ground floor has unusual tracery, irregular oval windows and flowing sculpted stone work. Much of the façade is decorated with a mosaic of broken ceramic tiles.` };
  const long = buildArrivalNarration({ lang: 'en', mode: walk, stopName: 'Casa Batlló', summary: casa, lead, nextStopName: null, style: 'standard' });
  assert.ok(long.includes('mosaic of broken ceramic tiles'), 'the second paragraph is told at a stop');
  assert.ok(long.includes('That was your last stop'), long);
  const fr = buildArrivalNarration({ lang: 'fr', mode: walk, stopName: 'Plaça de Catalunya', summary: { title: 'Place de Catalogne (Barcelone)', extract: "La place de Catalogne est une des principales places de Barcelone, en Espagne. D'une superficie d'environ 5 hectares, elle relie la Vieille-ville de Barcelone et l'Eixample." }, nextStopName: 'La Boqueria', nextDistance: 400, style: 'standard' });
  assert.ok(fr.startsWith("Vous voici à la place de Catalogne, une des principales places de Barcelone. D'une superficie d'environ 5 hectares"), fr);
  const de = buildArrivalNarration({ lang: 'de', mode: walk, stopName: 'Casa Batlló', summary: { title: 'Casa Batlló', extract: 'Die Casa Batlló ist ein von Antoni Gaudí gestaltetes Gebäude in Barcelona, Spanien. Es steht am Passeig de Gràcia.' }, nextStopName: 'Plaça de Catalunya', nextDistance: 400, style: 'standard' });
  assert.ok(de.startsWith('Sie sind bei Casa Batlló angekommen: ein von Antoni Gaudí gestaltetes Gebäude in Barcelona. Es steht am Passeig de Gràcia.'), de);
  const es = buildArrivalNarration({ lang: 'es', mode: walk, stopName: 'Barcelona Cathedral', city: 'Barcelona', summary: { title: 'Catedral de la Santa Cruz y Santa Eulalia (Barcelona)', extract: 'La Catedral de la Santa Cruz y Santa Eulalia es la catedral gótica de Barcelona, en Cataluña, España. Se construyó entre los siglos XIII y XV.' }, nextStopName: null, style: 'standard' });
  assert.ok(es.startsWith('Has llegado a la Catedral de la Santa Cruz y Santa Eulalia, la catedral gótica de Barcelona. Se construyó entre los siglos XIII y XV.'), es);
});

test('passing a place: the name, then what it is, within the mode’s length', () => {
  const text = buildPoiNarration({ lang: 'en', mode: walk, title: 'Royal Square (Barcelona)', summary: { title: 'Royal Square (Barcelona)', extract: 'The Royal Square is a square in the Barri Gòtic of Barcelona, Catalonia, Spain. It is close to La Rambla, and is a popular tourist attraction, especially at night.' }, direction: 'left', distance: 50, style: 'standard' });
  assert.equal(text, 'On your left: Royal Square, a square in the Barri Gòtic of Barcelona. It is close to La Rambla, and is a popular tourist attraction, especially at night.');
  const drive = buildPoiNarration({ lang: 'en', mode: MODES.drive, title: 'Royal Square (Barcelona)', summary: { description: 'Square in Barcelona, Spain' }, direction: 'right', distance: 300, style: 'standard' });
  assert.ok(drive.startsWith('On your right, in 300 meters: Royal Square. Square in Barcelona.'), drive);
});

test('the welcome: the city as this language names it, its definition folded in, no statistics', () => {
  const en = buildWelcomeNarration({ lang: 'en', cityName: 'Barcelona', citySummary: { title: 'Barcelona', extract: 'Barcelona is a city on the northeastern coast of Spain. It is the capital and largest city of the autonomous community of Catalonia, as well as the second-most populous municipality of Spain after Madrid.' }, lead: { text: 'Barcelona is a city on the northeastern coast of Spain. It is the capital and largest city of the autonomous community of Catalonia.\nFounded as a Roman city, in the Middle Ages Barcelona became the capital of the County of Barcelona.' }, hasStops: true, style: 'standard' });
  assert.equal(en, 'Welcome to Barcelona, a city on the northeastern coast of Spain. Founded as a Roman city, in the Middle Ages Barcelona became the capital of the County of Barcelona.');
  const fr = buildWelcomeNarration({ lang: 'fr', cityName: 'Barcelona', citySummary: { title: 'Barcelone', extract: "Barcelone est la capitale administrative et économique de la Catalogne, de la province de Barcelone, de la comarque du Barcelonès, en Espagne. Barcelone est la deuxième ville d'Espagne au regard de la population." }, hasStops: true, style: 'standard' });
  assert.ok(fr.startsWith('Bienvenue à Barcelone.'), fr);
  assert.ok(!/comarque|population/.test(fr), fr);
  const doc = buildWelcomeNarration({ lang: 'en', cityName: 'Barcelona', citySummary: { title: 'Barcelona', extract: 'Barcelona is a city on the northeastern coast of Spain.' }, hasStops: true, style: 'documentary' });
  assert.equal(doc, 'Welcome to Barcelona. Let us take a closer look. Barcelona is a city on the northeastern coast of Spain.');
});

test('polish puts it all together', () => {
  assert.equal(polish('Vous voici à le musée du Louvre, un musée de Paris, en France, ouvert 1793–1800.', 'fr'), 'Vous voici au musée du Louvre, un musée de Paris, ouvert 1793 à 1800.');
});

test('sentences as they are read: asides across a line break go, "St." ends no sentence, footnote marks go', () => {
  const de = 'Casa Batlló ([ˌka.zə bəʎˈʎo] \nkatalanisch, auch spanisch, für „Haus Batlló“ – benannt nach seinem Besitzer) ist ein Wohnhaus. Es gilt als Glanzstück.';
  assert.deepEqual(spokenSentences(de, 'de'), ['Casa Batlló ist ein Wohnhaus.', 'Es gilt als Glanzstück.']);
  assert.deepEqual(spokenSentences('Die Kathedrale Heilig Kreuz und St. Eulalia ist die Kathedrale des Erzbistums. Sie ist gotisch.', 'de'), ['Die Kathedrale Heilig Kreuz und Sankt Eulalia ist die Kathedrale des Erzbistums.', 'Sie ist gotisch.']);
  assert.deepEqual(spokenSentences('La construcción se realizó entre 1904 y 1906.\u200b Fue restaurada.', 'es'), ['La construcción se realizó entre 1904 y 1906.', 'Fue restaurada.']);
  assert.deepEqual(storySentences('Innerhalb des Stadtgebietes leben 1.731.649 Menschen. Sie liegt am Mittelmeer.', { count: 2, lang: 'de' }), ['Sie liegt am Mittelmeer.']);
  assert.deepEqual(storySentences('With a population of 1.6 million people it is big. Founded by Romans.', { count: 2, lang: 'en' }), ['Founded by Romans.']);
});

test('a foreign article in a name keeps its capital; a trailing comma in a subject is dropped', () => {
  assert.equal(placeName('La Boqueria', { title: 'Mercat de la Boqueria', extract: 'Die Markthallen des Mercat de la Boqueria liegen an der Rambla.' }, 'de'), 'La Boqueria');
  assert.equal(placeName('La Boqueria', { title: 'La Boquería', extract: 'El Mercado de San José, conocido como La Boquería, es un mercado municipal.' }, 'es'), 'la Boqueria', 'a Spanish article is lowercased mid-sentence');
  const it = buildArrivalNarration({ lang: 'it', mode: walk, stopName: 'Barcelona Cathedral', city: 'Barcelona', summary: { title: 'Cattedrale di Barcellona', extract: "La Cattedrale della Santa Croce e Sant'Eulalia, è la cattedrale-sede dell'arcidiocesi di Barcellona." }, nextStopName: null, style: 'standard' });
  assert.ok(it.startsWith("Eccoti alla Cattedrale della Santa Croce e Sant'Eulalia, la cattedrale-sede dell'arcidiocesi di Barcellona."), it);
  assert.equal(polish('Eccoti alla Cattedrale,, la cattedrale .', 'it'), 'Eccoti alla Cattedrale, la cattedrale.');
});
