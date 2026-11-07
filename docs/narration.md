# What the guide says

Roamie's stories come from Wikipedia, but a guide doesn't read an encyclopedia aloud. `js/story.js`
turns an article into what a guide would say; `js/narration.js` composes the lines. The rules, with
real examples from the sample tours (November 2026), and how they were checked.

## Before and after

Casa Batlló, English, at a stop:

> *Before:* You have arrived at Casa Batlló. Casa Batlló is a building in the center of Barcelona, Spain. It was
> designed by Antoni Gaudí, and is considered one of his masterpieces. A remodel of a previously built house, it
> was redesigned in 1904 by Gaudí and has been refurbished several times since. Gaudí's assistants Domènec
> Sugrañes i Gras, Josep Canaleta and Joan Rubió also contributed to the renovation project. Next stop…
>
> *After:* You have arrived at Casa Batlló, a building in the center of Barcelona. It was designed by Antoni Gaudí,
> and is considered one of his masterpieces. A remodel of a previously built house, it was redesigned in 1904 by
> Gaudí and has been refurbished several times since. Gaudí's assistants Domènec Sugrañes i Gras, Josep Canaleta
> and Joan Rubió also contributed to the renovation project. Casa Batlló is located on the Passeig de Gràcia in the
> Eixample district and forms part of a row of houses known as the Illa de la Discòrdia, so named because it
> features four striking, and strikingly different, buildings by noted Modernista architects of Barcelona. Next stop…

Barcelona Cathedral, French (the traveller typed the English name):

> *Before:* Vous voici à Barcelona Cathedral. La cathédrale basilique métropolitaine de la Sainte-Croix et de Sainte
> Eulalie de Barcelone, souvent surnommée Seu en catalan, est la cathédrale de l'archidiocèse catholique de Barcelone.
>
> *After:* Vous voici à la Cathédrale Sainte-Croix de Barcelone, la cathédrale de l'archidiocèse catholique de
> Barcelone. Les deux grandioses tours-clochers octogonales sont à la part postérieure de l'édifice…

The welcome, Italian (the first paragraph was all statistics):

> *Before:* Benvenuti a Barcelona. Barcellona è una città della Spagna di 1 656 725 abitanti, capoluogo della
> Catalogna, una comunità autonoma della parte orientale dello Stato…
>
> *After:* Benvenuti a Barcellona. Nel 1992 fu sede delle Olimpiadi estive. Nel 2004 vi si è tenuto per la prima
> volta assoluta il Forum Universale delle Culture…

## The rules

1. **The whole lead section at a stop.** Wikipedia's summary is the first paragraph only. At a stop there is time to
   listen, so the engine fetches the whole lead (`wiki.story`), several paragraphs, and reads up to the mode's
   `stopSentences` (6 on foot) within about 750 characters. Passing places keep the first paragraph (4 sentences,
   450 characters). The welcome gets 3 sentences from the city's lead.
2. **The definition folds into the line that names the place.** "X is a Y…" after "You have arrived at X." becomes
   "You have arrived at X, a Y…" (`mergeDefinition`). Present tense only, and only when the line ends with the name
   (so the narrator's two-sentence welcome is left alone). German keeps the nominative after a colon: *Sie sind bei
   Casa Batlló angekommen: ein von Antoni Gaudí gestaltetes Gebäude in Barcelona.* The same for places you pass
   (*On your left: Royal Square, a square in the Barri Gòtic*) and for the welcome (*Welcome to Barcelona, a city on
   the northeastern coast of Spain*).
3. **No country tails.** "…of Barcelona, Catalonia, Spain" → "…of Barcelona"; "à Barcelone, en Espagne" →
   "à Barcelone" (`dropCountryTails`). The country names come from the platform's own data (`Intl.DisplayNames`),
   in the listener's language. A country in a list ("between Spain, France and Andorra") stays.
4. **Statistics and administrative geography are skipped** when something better follows: population, census,
   municipality, autonomous community, comarca, postal code, GDP, twin towns, addresses, people counts
   ("1.731.649 Menschen"), in five languages (`storySentences`). So are list-like sentences over 320 characters.
   If nothing else is left, the first sentence is read anyway (a stop); the welcome says nothing rather than figures.
5. **Names in the listener's language.** A stop keeps the traveller's own name for it, unless that name has a word
   the article in this language never uses (a translation: "Eiffel Tower" in a French walk, "Barcelona Cathedral" in
   a German one). Then the article's own words: the definition's subject when it is short (*la tour Eiffel*, *les
   Tombeaux saadiens*), else the title with the article its kind takes (*la Cathédrale Sainte-Croix de Barcelone*,
   *der Dom*). Articles contract: *au musée du Louvre*, *alla Boqueria*, *al palacio*, *beim Dom*, *bei der
   Kathedrale*. English adds "the" where English puts one (*the Eiffel Tower*, *the Place de la Concorde*) and
   leaves *Casa Batlló*, *Jemaa el-Fna*, *Sumida Park*. The city's name follows the article's title (*Barcelone*,
   *Bruxelles*, *Marrakech*).
6. **Read aloud properly** (`expandForSpeech`): "1329–1383" → "1329 to 1383" (à, a, bis, a); a dash in a sentence
   becomes a comma; "&" → and; "c. 1400" → around 1400; "St." → Saint / Sankt; "e.g.", "z. B.", "n°", "Nr.",
   "Jh.", "sec." written out. Abbreviations are expanded before sentences are split, so "St." ends no sentence.
   Asides in parentheses and brackets (pronunciations, native names, footnote marks) go, even across a line break.
7. **Nothing twice.** A passing place whose article was already told under another title (a redirect) is skipped;
   a stop's article is never also told as a passing place.
8. **The camera view** tells its stories the same way (`js/lensView.js`).

## How it was checked

`tests/story.test.js` holds the rules above with examples in the five languages; `tests/narration.test.js` and
`tests/tourEngine.test.js` the lines as the engine speaks them. The rules were tuned on a transcript of the
Barcelona, Paris, Buenos Aires, Marrakesh and Tokyo sample tours fetched from the live Wikipedia in all five
languages, before and after (about 60 stops), then the browser tests ran a tour end to end.

## Known limits

- A proper name that starts with a kind word gets its article even when locals say it without
  ("Vous voici au Grand Palais" is right; "the Plaça Reial" is one of two usages).
- Wikipedia's own quality: a thin article stays thin; a lead that is all names and dates is read as such.
- The documentary narrator's phrasing exists in English, French, Spanish, German and Italian; other languages
  fall back to the standard phrases.
