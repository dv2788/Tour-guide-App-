// What's on: the big recurring events in a city that change a visit (a festival worth
// catching, crowds, closures). Each has a rule for its dates, worked out for any year: fixed
// days, "the last Sunday of August", days from Easter, or the Islamic or Chinese calendar
// (from the phone's own calendars). Dates are what usually happens: each event links to its
// article, so the exact days can be checked. Pure functions, so they can be tested.

const DAY = 86400000;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date, n) => new Date(date.getTime() + n * DAY);

/** Western Easter Sunday (Anonymous Gregorian algorithm). */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
export function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = utc(year, month, 1);
    return addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + 7 * (n - 1));
  }
  const last = utc(year, month + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

/** The Gregorian date of a day in another calendar ('islamic-umalqura', 'chinese') within a year. */
const calendarDays = new Map();
export function fromCalendar(year, calendar, month, day) {
  const key = `${calendar}:${year}`;
  if (!calendarDays.has(key)) {
    // Every day of the year in that calendar, once ("9/1" -> 18 February 2026).
    const days = new Map();
    try {
      const fmt = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
      if (fmt.resolvedOptions().calendar.startsWith(calendar.split('-')[0])) {
        for (let d = utc(year, 1, 1); d.getUTCFullYear() === year; d = addDays(d, 1)) {
          const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
          const k = `${Number(parts.month)}/${Number(parts.day)}`;
          if (!days.has(k)) days.set(k, d);
        }
      }
    } catch {
      // A browser without that calendar: no dates.
    }
    calendarDays.set(key, days);
  }
  return calendarDays.get(key).get(`${month}/${day}`) ?? null;
}

// Rules: each gives [first day, last day] in a year (or null).
const fixed = (m, d, days = 1) => (y) => [utc(y, m, d), utc(y, m, d + days - 1)];
const between = (m1, d1, m2, d2) => (y) => [utc(y, m1, d1), m2 < m1 ? utc(y + 1, m2, d2) : utc(y, m2, d2)];
const fromEaster = (from, to) => (y) => [addDays(easter(y), from), addDays(easter(y), to)];
const weekday = (month, wd, n, days = 1, offset = 0) => (y) => {
  const start = addDays(nthWeekday(y, month, wd, n), offset);
  return [start, addDays(start, days - 1)];
};
const lunar = (calendar, month, day, days) => (y) => {
  const start = fromCalendar(y, calendar, month, day);
  return start ? [start, addDays(start, days - 1)] : null;
};
// Chinese New Year as China announces it. Browsers' Chinese calendar is a day off in some years
// (7 February 2027 instead of the 6th; 2 February 2030 instead of the 3rd): the table wins.
const SPRING_FESTIVAL = { 2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3], 2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8] };
const chineseNewYear = (days) => (y) => {
  const known = SPRING_FESTIVAL[y];
  const start = known ? utc(y, known[0], known[1]) : fromCalendar(y, 'chinese', 1, 1);
  return start ? [start, addDays(start, days - 1)] : null;
};
const evenYears = (rule) => (y) => (y % 2 === 0 ? rule(y) : null);

// Who keeps which events (city names as people type them, without accents).
const FRANCE = ['paris', 'lyon', 'marseille', 'nice', 'bordeaux', 'toulouse', 'strasbourg', 'lille', 'nantes', 'annecy', 'colmar'];
const RAMADAN_CITIES = ['marrakesh', 'marrakech', 'fes', 'fez', 'casablanca', 'rabat', 'tangier', 'cairo', 'alexandria', 'luxor', 'tunis', 'dakar', 'zanzibar', 'stone town', 'istanbul'];
const CHRISTMAS_MARKETS = ['vienna', 'wien', 'berlin', 'munich', 'munchen', 'nuremberg', 'nurnberg', 'cologne', 'koln', 'dresden', 'prague', 'praha', 'strasbourg', 'colmar', 'salzburg', 'brussels', 'bruxelles', 'budapest'];
const JAPAN = ['tokyo', 'kyoto', 'osaka'];
const UK = ['london', 'edinburgh'];

export const EVENTS = [
  // France
  { name: 'Bastille Day', places: FRANCE, window: fixed(7, 14), usually: '14 July', note: "France's national day: fireworks in the evening, and in Paris a military parade on the Champs-Élysées in the morning. Some shops and museums close." },
  { name: 'Fête de la Musique', places: [...FRANCE, 'brussels', 'bruxelles'], window: fixed(6, 21), usually: '21 June', note: 'Free concerts in the streets and squares, all evening long.' },
  { name: 'European Heritage Days', places: [...FRANCE, 'brussels', 'bruxelles'], window: weekday(9, 6, 3, 2), usually: 'the third weekend of September', note: 'Buildings that are usually closed, ministries and palaces among them, open their doors, mostly for free. Expect queues.' },
  { name: 'Fête des Lumières', wiki: 'Festival of Lights (Lyon)', places: ['lyon'], window: fixed(12, 5, 6), usually: 'four nights around 8 December', note: 'Light shows on the buildings of the old town and candles in the windows. The evenings are very busy.' },
  // Spain
  { name: 'Holy Week', wiki: 'Holy Week in Seville', places: ['seville', 'sevilla', 'malaga', 'granada', 'toledo', 'madrid'], window: fromEaster(-7, 0), usually: 'the week before Easter', note: 'Processions through the streets day and night. The old town is crowded and some streets close.' },
  { name: 'Seville Fair', places: ['seville', 'sevilla'], window: fromEaster(13, 20), usually: 'two weeks after Easter', note: 'A week of flamenco dresses, horse carriages and casetas (party tents) at the fairground across the river.' },
  { name: 'La Mercè', places: ['barcelona'], window: fixed(9, 19, 10), usually: 'five days around 24 September, with a weekend', note: "Barcelona's biggest festival: human towers, giants, fire runs and free concerts across the old town." },
  { name: 'Sant Jordi', wiki: "Saint George's Day in Catalonia", places: ['barcelona'], window: fixed(4, 23), usually: '23 April', note: 'Book and rose stalls line the streets, especially La Rambla and Passeig de Gràcia.' },
  { name: 'Sant Joan', wiki: 'Saint John\'s Eve', places: ['barcelona'], window: fixed(6, 23, 2), usually: 'the night of 23 June', note: 'Fireworks and parties all night; the beaches are packed. The 24th is a holiday.' },
  { name: 'San Isidro', wiki: 'San Isidro Festival', places: ['madrid'], window: fixed(5, 13, 3), usually: 'around 15 May', note: "Madrid's patron saint: traditional dress, open-air dances and concerts, especially in the Pradera de San Isidro." },
  // Italy
  { name: 'Holy Week and Easter at the Vatican', wiki: 'Holy Week', places: ['rome', 'roma'], window: fromEaster(-7, 1), usually: 'the week before Easter', note: "Papal ceremonies; St Peter's Square is very crowded, and Easter Monday is a holiday." },
  { name: 'Natale di Roma', places: ['rome', 'roma'], window: fixed(4, 21), usually: '21 April', note: "Rome's birthday: historical parades and re-enactments around the Circus Maximus." },
  { name: 'Festa della Repubblica', places: ['rome', 'roma'], window: fixed(6, 2), usually: '2 June', note: 'National holiday with a military parade on Via dei Fori Imperiali, which closes to visitors that morning.' },
  { name: 'Carnival of Venice', places: ['venice', 'venezia'], window: fromEaster(-64, -47), usually: 'the two and a half weeks before Lent', note: 'Masks and costumes everywhere; the busiest days are the last weekend and Shrove Tuesday.' },
  { name: 'Festa del Redentore', places: ['venice', 'venezia'], window: weekday(7, 0, 3, 2, -1), usually: 'the third weekend of July', note: 'Fireworks over St Mark\'s Basin on the Saturday night, watched from boats and the quays.' },
  // Belgium, Netherlands
  { name: 'Belgian National Day', places: ['brussels', 'bruxelles'], window: fixed(7, 21), usually: '21 July', note: 'Military parade near the Royal Palace and festivities in the park; museums are often free.' },
  { name: 'Ommegang', wiki: 'Ommegang of Brussels', places: ['brussels', 'bruxelles'], window: fixed(7, 1, 7), usually: 'the first week of July', note: 'A Renaissance procession on the Grand-Place, with costumes, horses and flag-throwers (tickets for the seats).' },
  { name: 'Flower Carpet', wiki: 'Flower Carpet (Brussels)', places: ['brussels', 'bruxelles'], window: evenYears(fixed(8, 12, 7)), usually: 'a few days around 15 August, every other year', note: 'Half a million begonias cover the Grand-Place; the view from the Town Hall balcony is worth the queue.' },
  { name: "King's Day", wiki: 'Koningsdag', places: ['amsterdam', 'rotterdam', 'utrecht', 'the hague'], window: (y) => (utc(y, 4, 27).getUTCDay() === 0 ? fixed(4, 26)(y) : fixed(4, 27)(y)), usually: '27 April (26 April if a Sunday)', note: 'The whole city wears orange: street markets, boat parties on the canals and concerts. Very crowded.' },
  // Germany, Austria
  {
    name: 'Oktoberfest',
    places: ['munich', 'munchen'],
    // From the Saturday 15 days before the first Sunday in October, to that Sunday (or 3 October).
    window: (y) => {
      const end = nthWeekday(y, 10, 0, 1);
      return [addDays(end, -15), end.getUTCDate() < 3 ? utc(y, 10, 3) : end];
    },
    usually: 'the two weeks before the first Sunday of October',
    note: 'The beer festival on the Theresienwiese: hotels fill up and the beer tents are packed, especially at weekends.',
  },
  { name: 'Carnival of Cultures', wiki: 'Karneval der Kulturen', places: ['berlin'], window: fromEaster(48, 50), usually: 'Pentecost weekend', note: 'A street festival and parade in Kreuzberg celebrating the city\'s many cultures.' },
  { name: 'Vienna Opera Ball', places: ['vienna', 'wien'], window: fromEaster(-52, -52), usually: 'the Thursday before Ash Wednesday', note: 'The State Opera turns into a ballroom for one night, the high point of the ball season.' },
  { name: 'Christmas markets', wiki: 'Christmas market', places: CHRISTMAS_MARKETS, window: between(11, 22, 12, 23), usually: 'from late November until just before Christmas', note: 'Christmas markets in the squares, with mulled wine and crafts. Busiest in the evenings and at weekends.' },
  // United Kingdom
  { name: 'Notting Hill Carnival', places: ['london'], window: weekday(8, 1, -1, 2, -1), usually: 'the last weekend of August (Sunday and Monday)', note: "Europe's biggest street festival: steel bands, costumes and sound systems in west London. Very crowded." },
  { name: 'Bonfire Night', wiki: 'Guy Fawkes Night', places: UK, window: fixed(11, 5), usually: '5 November', note: 'Fireworks displays across the city, on the night itself and the weekends around it.' },
  { name: 'Edinburgh Festival Fringe', places: ['edinburgh'], window: fixed(8, 1, 25), usually: 'most of August', note: "The world's largest arts festival: shows everywhere, street performers on the Royal Mile. Book a bed early." },
  { name: 'Hogmanay', places: ['edinburgh'], window: fixed(12, 30, 3), usually: '30 December to 1 January', note: 'Torchlight procession, street party and fireworks over the castle (the street party needs a ticket).' },
  // United States
  { name: "Macy's Thanksgiving Day Parade", places: ['new york', 'new york city', 'manhattan'], window: weekday(11, 4, 4), usually: 'the fourth Thursday of November', note: 'Giant balloons down Central Park West and Sixth Avenue in the morning; arrive early for a spot.' },
  { name: 'San Francisco Pride', places: ['san francisco'], window: weekday(6, 0, -1, 2, -1), usually: 'the last weekend of June', note: 'The parade goes down Market Street on Sunday, with a celebration around Civic Center.' },
  { name: 'Art Basel Miami Beach', places: ['miami beach', 'miami'], window: fixed(12, 1, 10), usually: 'early December', note: 'The art fair takes over the Convention Center, with shows and parties all over town; hotels fill up.' },
  // Latin America
  { name: 'Tango Buenos Aires Festival', wiki: 'Tango Buenos Aires Festival y Mundial', places: ['buenos aires'], window: fixed(8, 15, 22), usually: 'late August to early September', note: 'Free concerts, dance classes and the Tango World Championship, with milongas all over the city.' },
  { name: 'Rio Carnival', wiki: 'Rio de Janeiro Carnival', places: ['rio de janeiro', 'rio'], window: fromEaster(-51, -46), usually: 'the days before Ash Wednesday', note: 'Samba school parades in the Sambadrome and street parties (blocos) all over the city. Book well ahead.' },
  { name: "New Year's Eve on Copacabana", wiki: 'Réveillon', places: ['rio de janeiro', 'rio'], window: fixed(12, 31), usually: '31 December', note: 'Millions gather on the beach, many dressed in white, for the fireworks at midnight.' },
  { name: 'Inti Raymi', places: ['cusco', 'cuzco'], window: fixed(6, 24), usually: '24 June', note: 'The Inca festival of the sun, staged at Qorikancha, the Plaza de Armas and Sacsayhuamán. June is festival month in Cusco.' },
  { name: 'Corpus Christi in Cusco', wiki: 'Corpus Christi (feast)', places: ['cusco', 'cuzco'], window: fromEaster(60, 60), usually: 'nine weeks after Easter (a Thursday)', note: 'The saints of the city\'s churches are carried in procession to the cathedral.' },
  { name: 'Fiestas Patrias', wiki: 'Fiestas Patrias (Peru)', places: ['lima', 'cusco', 'cuzco'], window: fixed(7, 28, 2), usually: '28 and 29 July', note: "Peru's independence days: a military parade in Lima on the 29th, flags everywhere; some museums close." },
  { name: 'Lord of Miracles', wiki: 'Lord of Miracles', places: ['lima'], window: fixed(10, 1, 31), usually: 'October', note: 'Lima\'s purple month: huge processions of the Señor de los Milagros, the biggest around 18 and 28 October.' },
  { name: 'Fiestas Patrias', wiki: 'Fiestas Patrias (Chile)', places: ['santiago', 'santiago de chile'], window: fixed(9, 18, 2), usually: '18 and 19 September', note: "Chile's national days: fondas (fairground parties) with food, cueca dancing and a military parade on the 19th." },
  { name: 'Independence of Cartagena', wiki: 'Independence of Cartagena', places: ['cartagena', 'cartagena de indias'], window: fixed(11, 6, 7), usually: 'the week around 11 November', note: 'Concerts, dancing in the streets of the walled city and a big parade (the Bando); the 11th is a holiday.' },
  { name: 'Day of the Dead', places: ['mexico city', 'ciudad de mexico', 'cdmx'], window: fixed(10, 31, 3), usually: '1 and 2 November', note: 'Altars, marigolds and a big parade; the cemeteries and the Zócalo fill up in the evenings.' },
  { name: 'Independence Day', wiki: 'Cry of Dolores', places: ['mexico city', 'ciudad de mexico', 'cdmx'], window: fixed(9, 15, 2), usually: 'the night of 15 September', note: 'The Grito in a packed Zócalo on the evening of the 15th, and a military parade on the 16th.' },
  // Africa
  { name: 'Ramadan', places: RAMADAN_CITIES, window: lunar('islamic-umalqura', 9, 1, 30), usually: 'a month that moves about 11 days earlier each year (the dates depend on the moon)', note: 'Many restaurants close by day and opening hours are shorter; after sunset the streets come alive. Be discreet about eating and drinking in public during the day.' },
  { name: 'Eid al-Fitr', places: RAMADAN_CITIES, window: lunar('islamic-umalqura', 10, 1, 3), usually: 'the end of Ramadan (the dates depend on the moon)', note: 'A family holiday: some shops, souks and sites close for a day or two.' },
  { name: 'Eid al-Adha', places: RAMADAN_CITIES, window: lunar('islamic-umalqura', 12, 10, 3), usually: 'about 70 days after Ramadan (the dates depend on the moon)', note: 'The biggest holiday of the year (Tabaski in Senegal): many shops and some sites close for a few days.' },
  { name: 'Cape Town Minstrel Carnival', places: ['cape town', 'kaapstad'], window: fixed(1, 2), usually: '2 January', note: 'Troupes in bright costumes parade through the city centre, singing and playing banjos.' },
  { name: 'Independence Day', wiki: 'Independence Day (Democratic Republic of the Congo)', places: ['kinshasa'], window: fixed(6, 30), usually: '30 June', note: 'National holiday, with official ceremonies in the city.' },
  { name: 'Independence Day', wiki: 'Independence Day (Senegal)', places: ['dakar'], window: fixed(4, 4), usually: '4 April', note: 'National holiday with a parade in the city centre.' },
  // Asia
  { name: 'Cherry blossom season', wiki: 'Hanami', places: JAPAN, window: fixed(3, 22, 18), usually: 'late March to early April (it varies with the weather)', note: 'Picnics under the blossom in the parks; the most famous spots are very crowded at weekends.' },
  { name: 'Japanese New Year', places: JAPAN, window: fixed(1, 1, 3), usually: '1 to 3 January', note: 'Shrines and temples are packed for the first visit of the year; many shops and museums close.' },
  { name: 'Sumidagawa Fireworks Festival', places: ['tokyo'], window: weekday(7, 6, -1), usually: 'the last Saturday of July', note: 'Twenty thousand fireworks over the Sumida River near Asakusa; the area is packed from the afternoon.' },
  { name: 'Gion Matsuri', places: ['kyoto'], window: fixed(7, 14, 11), usually: 'July, with float parades on 17 and 24 July', note: 'The giant floats are on show in the streets in the evenings before each parade.' },
  { name: 'Chinese New Year', places: ['shenzhen', 'guangzhou', 'beijing', 'shanghai', 'hong kong'], window: chineseNewYear(7), usually: 'late January or February (the dates follow the moon)', note: 'Families travel home: many shops and restaurants close for several days, and trains are full.' },
  { name: 'National Day Golden Week', wiki: 'Golden Week (China)', places: ['shenzhen', 'guangzhou', 'beijing', 'shanghai'], window: fixed(10, 1, 7), usually: '1 to 7 October', note: 'A week of holidays: sights are crowded and trains and flights are full.' },
];

/** "Lyon, France", "Bruxelles - Brussel", "FÈS" -> the names to look up ("lyon", "bruxelles", "brussel", "fes"). */
export function cityKeys(name) {
  const plain = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const first = plain.split(/[,(]/)[0];
  return [...new Set([first, ...first.split(/\s+[-/]\s+|\s*\/\s*/)].map((s) => s.trim()).filter(Boolean))];
}

/**
 * The events in a city that are on during, or start within `ahead` days of, `date`:
 * [{ event, start, end, on }], soonest first.
 */
export function eventsFor(cityName, date = new Date(), { ahead = 21 } = {}) {
  const keys = new Set(cityKeys(cityName));
  if (!keys.size) return [];
  const today = utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const until = addDays(today, ahead);
  const found = [];
  for (const event of EVENTS) {
    if (!event.places.some((p) => keys.has(p))) continue;
    for (const y of [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const w = event.window(y);
      if (!w) continue;
      const [start, end] = w;
      if (end < today || start > until) continue;
      found.push({ event, start, end, on: start <= today });
      break;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** "8 December", "5–10 December", "30 December – 1 January". */
export function formatDays(start, end, locale = 'en-GB') {
  const day = (d, withMonth = true) => new Intl.DateTimeFormat(locale, { day: 'numeric', ...(withMonth ? { month: 'long' } : {}), timeZone: 'UTC' }).format(d);
  if (start.getTime() === end.getTime()) return day(start);
  if (start.getUTCMonth() === end.getUTCMonth()) return `${day(start, false)}–${day(end)}`;
  return `${day(start)} – ${day(end)}`;
}

/** The article to read about an event. */
export function eventLink(event, lang = 'en') {
  return `https://${lang}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(event.wiki ?? event.name)}`;
}
