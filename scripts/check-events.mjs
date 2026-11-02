// Checks the events in js/events.js against Wikipedia: each one's article should exist and its
// introduction should mention the month(s) Roamie gives for it. Flags what to look at by hand
// (a festival that moved, a mistake). Meant to be run now and then: `npm run check:events`.
// Gentle with Wikipedia: one request every 3 s, patient when it's busy.
import { EVENTS } from '../js/events.js';

const UA = 'Roamie-events-check/1.0 (https://github.com/dv2788/Tour-guide-App-)';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function summary(title) {
  for (let a = 0; a < 8; a++) {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) return res.json();
    await wait(Math.min(300000, 20000 * 2 ** a));
  }
  throw new Error(`Wikipedia kept refusing (${title})`);
}

const year = new Date().getUTCFullYear();
let flagged = 0;
for (const event of EVENTS) {
  const title = event.wiki ?? event.name;
  const s = await summary(title);
  await wait(3000);
  const window = event.window(year) ?? event.window(year + 1);
  // Months the event touches, by its rule (moon calendars move: no month to expect).
  const lunar = /moon/.test(event.usually);
  const months = new Set();
  if (window && !lunar) for (let d = new Date(window[0]); d <= window[1]; d = new Date(d.getTime() + 86400000)) months.add(MONTHS[d.getUTCMonth()]);
  const text = `${s?.extract ?? ''} ${s?.description ?? ''}`;
  const mentioned = [...months].filter((m) => text.includes(m));
  let verdict = 'ok';
  if (!s) verdict = 'NO ARTICLE';
  else if (s.type === 'disambiguation') verdict = 'DISAMBIGUATION PAGE';
  else if (months.size && !mentioned.length) verdict = `no mention of ${[...months].join('/')}`;
  if (verdict !== 'ok') flagged++;
  console.log(`${verdict === 'ok' ? '✓' : '?'} ${event.name} [${title} -> ${s?.title ?? '-'}]: ${verdict}`);
}
console.log(`\n${flagged} of ${EVENTS.length} events to look at by hand.`);
process.exitCode = flagged ? 1 : 0;
