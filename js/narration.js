// Composing what the guide actually says: the phrase that names the place, with its
// definition folded in ("You have arrived at Casa Batlló, a building in the centre of
// Barcelona"), then the sentences of its story worth hearing (js/story.js).

import { t, formatDistance } from './i18n.js';
import { storySentences, spokenSentences, mergeDefinition, spokenName, plainTitle, polish } from './story.js';

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// How much to say: at a stop there is time to listen; passing by, less.
const STOP_CHARS = 750;
const PASSING_CHARS = 450;
const CITY_CHARS = 420;

/** The sentences to tell about a place: its whole lead section when we have it, else its summary. */
function storyOf({ lead, summary }, count, lang, maxChars, fallback = true) {
  const text = lead?.text || summary?.extract || '';
  if (text) return storySentences(text, { count, lang, maxChars, fallback });
  if (summary?.description) return [`${capitalize(summary.description.replace(/\.$/, ''))}.`];
  return [];
}

/** An intro that names the place, then its story, the definition folded into the intro when it can be. */
function introduce(intro, name, sentences, lang) {
  const merged = sentences.length ? mergeDefinition(intro, sentences[0], name, lang) : null;
  return [merged ?? intro, ...(merged ? sentences.slice(1) : sentences)].join(' ');
}

/**
 * How the guide says a stop's name: the traveller's own words, unless the article in this
 * language calls it something else entirely (see spokenName).
 */
export function placeName(name, summary, lang, { city = '', preferTitle = false } = {}) {
  const first = summary?.extract ? spokenSentences(summary.extract, lang)[0] : null;
  return spokenName(name, { title: summary?.title, firstSentence: first, ignore: city, preferTitle }, lang);
}

/** "On your right" / "On your right, in 300 meters" depending on the travel mode. */
// `style` is 'standard' or 'documentary' (the narrator voices' phrasing).

export function directionPhrase({ lang, direction, distance, mode, style }) {
  let phrase = t(lang, direction, {}, style);
  if (mode.announceDistance && direction !== 'behind' && direction !== 'nearby' && distance >= 120) {
    phrase += ', ' + t(lang, 'inDistance', { d: formatDistance(lang, distance) }, style);
  }
  return phrase;
}

export function buildPoiNarration({ lang, mode, title, summary, direction, distance, style }) {
  const name = plainTitle(title);
  const intro = t(lang, 'poiIntro', { dir: directionPhrase({ lang, direction, distance, mode, style }), title: name }, style);
  const sentences = storyOf({ summary }, mode.sentences, lang, PASSING_CHARS);
  return polish(introduce(intro, name, sentences, lang), lang);
}

export function buildWelcomeNarration({ lang, cityName, citySummary, lead = null, hasStops, style, happening = null }) {
  const name = cityName ? placeName(cityName, citySummary, lang, { preferTitle: true }) : null;
  const intro = name ? t(lang, 'welcome', { city: name }, style) : t(lang, 'started', {}, style);
  const sentences = storyOf({ lead, summary: citySummary }, 3, lang, CITY_CHARS, false); // statistics only: say nothing
  const parts = [name ? introduce(intro, name, sentences, lang) : [intro, ...sentences].join(' ')];
  // What's on in the city ("Coming up: Bonfire Night, on 5 November."). English only for now:
  // the events' names and notes are written in English.
  if (happening && lang === 'en') parts.push(happeningSentence(happening));
  if (!hasStops) parts.push(t(lang, 'freeRoam', {}, style));
  return polish(parts.join(' '), lang);
}

/** { name, on, start, end } (days as "5 November") -> one short sentence, whatever the name. */
export function happeningSentence({ name, on, start, end }) {
  if (on) return start === end ? `Happening today: ${name}.` : `Happening now: ${name}, until ${end}.`;
  return start === end ? `Coming up: ${name}, on ${start}.` : `Coming up: ${name}, from ${start}.`;
}

export function buildFirstStopNarration({ lang, stopName, distance, style }) {
  return polish(t(lang, 'firstStop', { name: stopName, d: formatDistance(lang, distance) }, style), lang);
}

const BREAK_KEYS = { coffee: 'breakCoffee', lunch: 'breakLunch', dinner: 'breakDinner', drink: 'breakDrink' };

// From this long at a place, the guide says how long to stay and lets you explore in peace.
export const LINGER_MINUTES = 20;

export function buildArrivalNarration({ lang, mode, stopName, summary, lead = null, nextStopName, nextDistance, style, kind, meal, visitMinutes, stayMinutes, city = '' }) {
  const name = placeName(stopName, summary, lang, { city });
  const parts = [];
  if (kind === 'food') {
    // A break: no history lecture (unless the place has its own story), and then quiet.
    parts.push(t(lang, BREAK_KEYS[meal] ?? 'breakCoffee', {}, style));
    parts.push(...storyOf({ summary }, 2, lang, PASSING_CHARS));
    parts.push(t(lang, 'breakAt', { name }, style));
  } else {
    const intro = t(lang, 'arrived', { name }, style);
    const sentences = storyOf({ lead, summary }, mode.stopSentences, lang, STOP_CHARS);
    parts.push(introduce(intro, name, sentences, lang));
    if (visitMinutes) parts.push(t(lang, 'museumVisit', { n: visitMinutes }, style));
    else if (stayMinutes >= LINGER_MINUTES) parts.push(t(lang, 'stayHere', { n: stayMinutes }, style));
  }
  if (nextStopName) parts.push(t(lang, 'nextStop', { name: nextStopName, d: formatDistance(lang, nextDistance) }, style));
  else parts.push(t(lang, 'tourDone', {}, style));
  return polish(parts.join(' '), lang);
}
