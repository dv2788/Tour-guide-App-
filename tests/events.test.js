import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, easter, nthWeekday, fromCalendar, eventsFor, cityKeys, formatDays, eventLink } from '../js/events.js';

const iso = (d) => d.toISOString().slice(0, 10);
const on = (city, day, opts) => eventsFor(city, new Date(`${day}T12:00:00Z`), opts).map((e) => `${e.event.name} ${iso(e.start)}..${iso(e.end)}${e.on ? ' (on)' : ''}`);

test('date rules: Easter, nth weekdays, and the Islamic and Chinese calendars', () => {
  assert.deepEqual([2024, 2025, 2026, 2027].map((y) => iso(easter(y))), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28']);
  assert.equal(iso(nthWeekday(2026, 11, 4, 4)), '2026-11-26', 'Thanksgiving 2026');
  assert.equal(iso(nthWeekday(2026, 8, 1, -1)), '2026-08-31', 'last Monday of August 2026');
  assert.equal(iso(fromCalendar(2026, 'islamic-umalqura', 9, 1)), '2026-02-18', 'Ramadan 1447 begins');
  assert.equal(iso(fromCalendar(2026, 'chinese', 1, 1)), '2026-02-17', 'Chinese New Year 2026');
});

test('famous events land on their real dates', () => {
  assert.deepEqual(on('Rio de Janeiro', '2026-02-10'), ['Rio Carnival 2026-02-13..2026-02-18'], 'Friday to Ash Wednesday');
  assert.ok(on('Munich', '2026-09-20')[0].startsWith('Oktoberfest 2026-09-19..2026-10-04 (on)'));
  assert.ok(on('München', '2023-09-20')[0].startsWith('Oktoberfest 2023-09-16..2023-10-03'), 'runs to 3 October when the first Sunday is earlier');
  assert.ok(on('Seville', '2026-04-15').includes('Seville Fair 2026-04-18..2026-04-25'));
  assert.ok(on('Amsterdam', '2025-04-20').includes("King's Day 2025-04-26..2025-04-26"), '26 April when the 27th is a Sunday');
  assert.ok(on('London', '2026-08-25').includes('Notting Hill Carnival 2026-08-30..2026-08-31'));
  assert.ok(on('Marrakesh', '2026-02-20').some((e) => e.startsWith('Ramadan 2026-02-18..2026-03-19 (on)')));
  assert.ok(on('Brussels', '2026-08-10').some((e) => e.startsWith('Flower Carpet')), 'even years');
  assert.ok(!on('Brussels', '2027-08-10').some((e) => e.startsWith('Flower Carpet')), 'not in odd years');
  assert.ok(on('Edinburgh', '2026-12-31').includes('Hogmanay 2026-12-30..2027-01-01 (on)'), 'across the new year');
});

test('cities are matched however they are typed, and only nearby dates count', () => {
  assert.deepEqual(cityKeys('Bruxelles - Brussel'), ['bruxelles - brussel', 'bruxelles', 'brussel']);
  assert.deepEqual(cityKeys('FÈS, Morocco'), ['fes']);
  assert.ok(on('Lyon, France', '2026-12-01').some((e) => e.startsWith('Fête des Lumières')));
  assert.deepEqual(on('Lyon', '2026-03-01'), [], 'nothing in early March');
  assert.deepEqual(on('Nowhere-sur-Mer', '2026-07-14'), []);
  assert.deepEqual(on('Paris', '2026-07-01', { ahead: 7 }), [], 'Bastille Day is 13 days away');
});

test('every event has what the app shows: places, a rule that works, words and a link', () => {
  for (const e of EVENTS) {
    assert.ok(e.name && e.usually && e.note && e.places.length, e.name);
    const w = e.window(2026) ?? e.window(2027);
    assert.ok(w && w[0] <= w[1] && w[1] - w[0] < 40 * 86400000, `${e.name}: a window of under 40 days`);
    assert.match(eventLink(e), /^https:\/\/en\.wikipedia\.org\/wiki\/Special:Search\?search=/);
  }
  assert.equal(formatDays(new Date('2026-12-05T00:00:00Z'), new Date('2026-12-10T00:00:00Z')), '5–10 December');
  assert.equal(formatDays(new Date('2026-12-30T00:00:00Z'), new Date('2027-01-01T00:00:00Z')), '30 December – 1 January');
  assert.equal(formatDays(new Date('2026-07-14T00:00:00Z'), new Date('2026-07-14T00:00:00Z')), '14 July');
});

test('the guide mentions what is on when the tour starts (English tours), in words that suit any name', async () => {
  const { buildWelcomeNarration, happeningSentence } = await import('../js/narration.js');
  const soon = { name: 'Bonfire Night', on: false, start: '5 November', end: '5 November' };
  assert.equal(buildWelcomeNarration({ lang: 'en', cityName: 'London', citySummary: null, hasStops: true, happening: soon }), 'Welcome to London. Coming up: Bonfire Night, on 5 November.');
  assert.equal(happeningSentence({ name: 'Christmas markets', on: true, start: '22 November', end: '23 December' }), 'Happening now: Christmas markets, until 23 December.');
  assert.equal(happeningSentence({ name: 'Bastille Day', on: true, start: '14 July', end: '14 July' }), 'Happening today: Bastille Day.');
  assert.equal(buildWelcomeNarration({ lang: 'fr', cityName: 'Lyon', citySummary: null, hasStops: true, happening: soon }), 'Bienvenue à Lyon.', 'not in French yet: the names and notes are English');
});

test('Chinese New Year goes by the official dates, not the browser’s calendar (a day off in 2027)', () => {
  const cny = EVENTS.find((e) => e.name === 'Chinese New Year');
  assert.equal(cny.window(2027)[0].toISOString().slice(0, 10), '2027-02-06');
  assert.equal(cny.window(2030)[0].toISOString().slice(0, 10), '2030-02-03');
  assert.equal(cny.window(2026)[0].toISOString().slice(0, 10), '2026-02-17');
  assert.ok(cny.window(2040), 'beyond the table, the browser’s calendar still gives a date');
  const shenzhen = eventsFor('Shenzhen', new Date('2027-02-06T09:00Z'), { ahead: 0 });
  assert.ok(shenzhen.some((e) => e.event.name === 'Chinese New Year'), 'on the day itself');
});
