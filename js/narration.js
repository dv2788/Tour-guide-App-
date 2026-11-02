// Composing what the guide actually says.

import { t, formatDistance } from './i18n.js';
import { cleanForSpeech, firstSentences } from './text.js';

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function story(summary, sentences, lang) {
  if (summary?.extract) return firstSentences(cleanForSpeech(summary.extract), sentences, lang);
  if (summary?.description) return capitalize(summary.description.replace(/\.$/, '')) + '.';
  return '';
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
  const intro = t(lang, 'poiIntro', { dir: directionPhrase({ lang, direction, distance, mode, style }), title }, style);
  return [intro, story(summary, mode.sentences, lang)].filter(Boolean).join(' ');
}

export function buildWelcomeNarration({ lang, cityName, citySummary, hasStops, style, happening = null }) {
  const parts = [cityName ? t(lang, 'welcome', { city: cityName }, style) : t(lang, 'started', {}, style)];
  const s = story(citySummary, 2, lang);
  if (s) parts.push(s);
  // What's on in the city ("Coming up: Bonfire Night, on 5 November."). English only for now:
  // the events' names and notes are written in English.
  if (happening && lang === 'en') parts.push(happeningSentence(happening));
  if (!hasStops) parts.push(t(lang, 'freeRoam', {}, style));
  return parts.join(' ');
}

/** { name, on, start, end } (days as "5 November") -> one short sentence, whatever the name. */
export function happeningSentence({ name, on, start, end }) {
  if (on) return start === end ? `Happening today: ${name}.` : `Happening now: ${name}, until ${end}.`;
  return start === end ? `Coming up: ${name}, on ${start}.` : `Coming up: ${name}, from ${start}.`;
}

export function buildFirstStopNarration({ lang, stopName, distance, style }) {
  return t(lang, 'firstStop', { name: stopName, d: formatDistance(lang, distance) }, style);
}

const BREAK_KEYS = { coffee: 'breakCoffee', lunch: 'breakLunch', dinner: 'breakDinner', drink: 'breakDrink' };

export function buildArrivalNarration({ lang, mode, stopName, summary, nextStopName, nextDistance, style, kind, meal, visitMinutes }) {
  const parts = [];
  if (kind === 'food') {
    // A break: no history lecture (unless the place has its own story), and then quiet.
    parts.push(t(lang, BREAK_KEYS[meal] ?? 'breakCoffee', {}, style));
    const s = story(summary, 2, lang);
    if (s) parts.push(s);
    parts.push(t(lang, 'breakAt', { name: stopName }, style));
  } else {
    parts.push(t(lang, 'arrived', { name: stopName }, style));
    const s = story(summary, mode.stopSentences, lang);
    if (s) parts.push(s);
    if (visitMinutes) parts.push(t(lang, 'museumVisit', { n: visitMinutes }, style));
  }
  if (nextStopName) parts.push(t(lang, 'nextStop', { name: nextStopName, d: formatDistance(lang, nextDistance) }, style));
  else parts.push(t(lang, 'tourDone', {}, style));
  return parts.join(' ');
}
