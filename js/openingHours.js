// Reading OpenStreetMap opening hours ("Mo-Fr 08:00-19:00; Sa 09:00-14:00; Su off") to know
// whether a café or restaurant will be open when the traveller gets there.
// Covers the common forms. Anything fancier (public holidays, months, sunrise…) gives
// `null` = "unknown", so a place is never wrongly rejected.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_RANGE = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/;
const TIME_RANGE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function parseDays(selector) {
  const days = new Set();
  for (const part of selector.split(',')) {
    const m = part.trim().match(DAY_RANGE);
    if (!m) return null;
    const from = DAYS.indexOf(m[1]);
    const to = m[2] ? DAYS.indexOf(m[2]) : from;
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return days;
}

function parseTimes(text) {
  const intervals = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(TIME_RANGE);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (end <= start) end += 24 * 60; // open past midnight (e.g. 18:00-02:00)
    intervals.push([start, end]);
  }
  return intervals;
}

/** Weekly schedule: 7 lists (Monday first) of [startMinute, endMinute] intervals, or null if unreadable. */
export function parseOpeningHours(spec) {
  if (!spec || typeof spec !== 'string') return null;
  const text = spec.trim();
  if (text === '24/7') return Array.from({ length: 7 }, () => [[0, 24 * 60]]);
  const week = Array.from({ length: 7 }, () => []);
  let understood = false;
  for (const raw of text.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    if (/^(PH|SH)\b/.test(rule)) continue; // public/school holidays: ignored
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
    const days = m[1] ? parseDays(m[1].replace(/\s+/g, '')) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const rest = m[2].trim().replace(/^,?\s*PH\s*/, '');
    let intervals;
    if (/^(off|closed)$/i.test(rest)) intervals = [];
    else {
      intervals = parseTimes(rest.replace(/\s+/g, ''));
      if (!intervals) return null; // something we don't read: unknown
    }
    for (const d of days) week[d] = intervals; // later rules override earlier ones
    understood = true;
  }
  return understood ? week : null;
}

/**
 * Is the place open for the whole of [start, start + minutes]?
 * Returns { open: true | false | null, closes: minutes-of-day | null }.
 */
export function openDuring(spec, start, minutes = 30) {
  const week = parseOpeningHours(spec);
  if (!week) return { open: null, closes: null };
  const day = (start.getDay() + 6) % 7; // Monday = 0
  const t = start.getHours() * 60 + start.getMinutes();
  const end = t + minutes;
  // Today's intervals, and yesterday's that run past midnight.
  const candidates = [
    ...week[day].map(([a, b]) => [a, b]),
    ...week[(day + 6) % 7].filter(([, b]) => b > 24 * 60).map(([a, b]) => [a - 24 * 60, b - 24 * 60]),
  ];
  const fit = candidates.find(([a, b]) => a <= t && end <= b);
  if (fit) {
    // Open round the clock (24/7, or today's hours running into tomorrow's): no closing time to show.
    const allDay = fit[0] <= 0 && fit[1] >= 24 * 60;
    return { open: true, closes: allDay ? null : fit[1] % (24 * 60) };
  }
  return { open: false, closes: null };
}

/** "19:00" from minutes of the day. */
export function formatClock(minutesOfDay) {
  const h = Math.floor(minutesOfDay / 60) % 24;
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
