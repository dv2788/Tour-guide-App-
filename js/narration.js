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
export function directionPhrase({ lang, direction, distance, mode }) {
  let phrase = t(lang, direction);
  if (mode.announceDistance && direction !== 'behind' && direction !== 'nearby' && distance >= 120) {
    phrase += ', ' + t(lang, 'inDistance', { d: formatDistance(lang, distance) });
  }
  return phrase;
}

export function buildPoiNarration({ lang, mode, title, summary, direction, distance }) {
  const intro = t(lang, 'poiIntro', { dir: directionPhrase({ lang, direction, distance, mode }), title });
  return [intro, story(summary, mode.sentences, lang)].filter(Boolean).join(' ');
}

export function buildWelcomeNarration({ lang, cityName, citySummary, hasStops }) {
  const parts = [cityName ? t(lang, 'welcome', { city: cityName }) : t(lang, 'started')];
  const s = story(citySummary, 2, lang);
  if (s) parts.push(s);
  if (!hasStops) parts.push(t(lang, 'freeRoam'));
  return parts.join(' ');
}

export function buildFirstStopNarration({ lang, stopName, distance }) {
  return t(lang, 'firstStop', { name: stopName, d: formatDistance(lang, distance) });
}

export function buildArrivalNarration({ lang, mode, stopName, summary, nextStopName, nextDistance }) {
  const parts = [t(lang, 'arrived', { name: stopName })];
  const s = story(summary, mode.stopSentences, lang);
  if (s) parts.push(s);
  if (nextStopName) parts.push(t(lang, 'nextStop', { name: nextStopName, d: formatDistance(lang, nextDistance) }));
  else parts.push(t(lang, 'tourDone'));
  return parts.join(' ');
}
