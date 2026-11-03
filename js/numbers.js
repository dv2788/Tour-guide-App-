// Numbers as a guide would say them, written out in words: years, counts, decimals,
// percentages, ordinals, regnal numbers (Louis XIV) and centuries, in the app's five languages.
// For the AI voice that reads letters rather than phonemes (Supertonic 3): it reads "1904"
// right in English and French but not reliably in German, Spanish or Italian. Written out,
// it's right everywhere. Anything unusual (long digit strings, codes) is left alone.

const ROMAN = 'M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})';
const ROMAN_ONLY = new RegExp(`^${ROMAN}$`);
const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToNumber(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VALUES[s[i]];
    total += v < (ROMAN_VALUES[s[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

/** A regnal number or a century: a valid numeral worth 1 to 39 (anything bigger is a word like "MIX" or "DC"). */
function smallRoman(s) {
  if (!s || !ROMAN_ONLY.test(s)) return 0;
  const n = romanToNumber(s);
  return n >= 1 && n <= 39 ? n : 0;
}

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- English ----------
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const enUnder100 = (n) => (n < 20 ? EN_ONES[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_ONES[n % 10]}` : ''));

function enUnder1000(n) {
  if (n < 100) return enUnder100(n);
  const rest = n % 100;
  return `${EN_ONES[Math.floor(n / 100)]} hundred${rest ? ` and ${enUnder100(rest)}` : ''}`;
}

function enCardinal(n) {
  if (n < 1000) return enUnder1000(n);
  const parts = [];
  for (const [value, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= value) {
      parts.push(`${enUnder1000(Math.floor(n / value))} ${name}`);
      n %= value;
    }
  }
  if (n) parts.push(`${n < 100 ? 'and ' : ''}${enUnder1000(n)}`);
  return parts.join(' ');
}

/** "nineteen oh four", "nineteen hundred", "two thousand and five", "twenty twenty-five", "ten sixty-six". */
function enYear(n) {
  if (n % 1000 === 0 || (n >= 2001 && n <= 2009)) return enCardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${enUnder100(hi)} hundred`;
  return `${enUnder100(hi)} ${lo < 10 ? `oh ${EN_ONES[lo]}` : enUnder100(lo)}`;
}

/** "the 1880s": "eighteen eighties"; "the 1900s": "nineteen hundreds". */
function enDecade(n) {
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${enUnder100(hi)} hundreds`;
  if (lo % 10) return `${enYear(n)}s`;
  if (n >= 2000 && n < 2010) return 'two thousands';
  return `${enUnder100(hi)} ${lo === 10 ? 'tens' : EN_TENS[lo / 10].replace(/y$/, 'ies')}`;
}

const EN_ORDINAL_IRREGULAR = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

function enOrdinal(n) {
  return enCardinal(n).replace(/[a-z]+$/, (w) => EN_ORDINAL_IRREGULAR[w] ?? (w.endsWith('y') ? `${w.slice(0, -1)}ieth` : `${w}th`));
}

// Names before a numeral that take a plain number: "World War Two", "Chapter Four" (not "the fourth").
const EN_PLAIN_AFTER = /^(?:War|Part|Chapter|Act|Book|Volume|Phase|Type|Level|Class|Grade|Mark|Apollo|Stage|Round|Group|Division|Line|Zone|Area|Route|Terminal|Platform|Generation|Title|Article|Section|Model)$/;

// ---------- French ----------
const FR_ONES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function frUnder100(n) {
  if (n < 20) return FR_ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) return t === 7 && u === 1 ? 'soixante et onze' : `${FR_TENS[t]}-${FR_ONES[10 + u]}`;
  if (u === 0) return t === 8 ? 'quatre-vingts' : FR_TENS[t];
  if (u === 1 && t !== 8) return `${FR_TENS[t]} et un`;
  return `${FR_TENS[t]}-${FR_ONES[u]}`;
}

function frUnder1000(n) {
  if (n < 100) return frUnder100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const hundreds = h === 1 ? 'cent' : `${FR_ONES[h]} cent${r ? '' : 's'}`;
  return r ? `${hundreds} ${frUnder100(r)}` : hundreds;
}

function frCardinal(n) {
  if (n < 1000) return frUnder1000(n);
  const parts = [];
  for (const [value, one, many] of [[1e9, 'un milliard', 'milliards'], [1e6, 'un million', 'millions']]) {
    if (n >= value) {
      const k = Math.floor(n / value);
      parts.push(k === 1 ? one : `${frUnder1000(k)} ${many}`);
      n %= value;
    }
  }
  if (n >= 1000) {
    const k = Math.floor(n / 1000);
    parts.push(k === 1 ? 'mille' : `${frUnder1000(k)} mille`);
    n %= 1000;
  }
  if (n) parts.push(frUnder1000(n));
  return parts.join(' ');
}

function frOrdinal(n, feminine = false) {
  if (n === 1) return feminine ? 'première' : 'premier';
  return frCardinal(n).replace(/[\p{L}-]+$/u, (word) => {
    let w = word.replace(/s$/, '');
    if (w.endsWith('cinq')) w += 'u';
    else if (w.endsWith('neuf')) w = `${w.slice(0, -1)}v`;
    else if (w.endsWith('e')) w = w.slice(0, -1);
    return `${w}ième`;
  });
}

// ---------- Spanish ----------
const ES_ONES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const ES_TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const ES_HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function esUnder1000(n) {
  if (n === 100) return 'cien';
  if (n < 30) return ES_ONES[n];
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(ES_HUNDREDS[h]);
  if (r >= 30) parts.push(r % 10 ? `${ES_TENS[Math.floor(r / 10)]} y ${ES_ONES[r % 10]}` : ES_TENS[Math.floor(r / 10)]);
  else if (r) parts.push(ES_ONES[r]);
  return parts.join(' ');
}

// "un" before mil and millones: "veintiún mil".
const esBefore = (words) => words.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

function esUnder1e6(n) {
  if (n < 1000) return esUnder1000(n);
  const k = Math.floor(n / 1000);
  const r = n % 1000;
  const thousands = k === 1 ? 'mil' : `${esBefore(esUnder1000(k))} mil`;
  return r ? `${thousands} ${esUnder1000(r)}` : thousands;
}

function esCardinal(n) {
  if (n < 1e6) return esUnder1e6(n);
  const m = Math.floor(n / 1e6);
  const r = n % 1e6;
  const millions = m === 1 ? 'un millón' : `${esBefore(esUnder1e6(m))} millones`;
  return r ? `${millions} ${esUnder1e6(r)}` : millions;
}

const ES_ORDINALS = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];
const esOrdinal = (n) => ES_ORDINALS[n] ?? esCardinal(n); // Felipe segundo, Alfonso trece

// ---------- German ----------
const DE_ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

/** before: "hundert" or "tausend" follows, so "ein", not "eins". */
function deUnder100(n, before) {
  if (n === 1) return before ? 'ein' : 'eins';
  if (n < 20) return DE_ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${u === 1 ? 'ein' : DE_ONES[u]}und${DE_TENS[t]}` : DE_TENS[t];
}

/** first: nothing precedes, so "hundert", not "einhundert". */
function deUnder1000(n, before, first) {
  if (n < 100) return deUnder100(n, before);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return `${h === 1 ? (first ? '' : 'ein') : DE_ONES[h]}hundert${r ? deUnder100(r, before) : ''}`;
}

function deCardinal(n) {
  if (n < 1000) return deUnder1000(n, false, true);
  const parts = [];
  for (const [value, one, many] of [[1e9, 'eine Milliarde', 'Milliarden'], [1e6, 'eine Million', 'Millionen']]) {
    if (n >= value) {
      const k = Math.floor(n / value);
      parts.push(k === 1 ? one : `${deUnder1000(k, false, true)} ${many}`);
      n %= value;
    }
  }
  let word = '';
  if (n >= 1000) {
    const k = Math.floor(n / 1000);
    word = `${k === 1 ? (parts.length ? 'ein' : '') : deUnder1000(k, true, !parts.length)}tausend`;
    n %= 1000;
  }
  if (n) word += deUnder1000(n, false, !word && !parts.length);
  if (word) parts.push(word);
  return parts.join(' ');
}

/** Years 1100–1999 are said in hundreds: "neunzehnhundertvier". */
function deYear(n) {
  if (n < 1100 || n >= 2000) return deCardinal(n);
  const lo = n % 100;
  return `${deUnder100(Math.floor(n / 100), true)}hundert${lo ? deUnder100(lo, false) : ''}`;
}

/** "vierzehnte" (callers add "n" for "im vierzehnten Jahrhundert"). */
function deOrdinal(n) {
  const w = deCardinal(n);
  const r = n % 100;
  if (r === 1) return w.replace(/eins$/, 'erste');
  if (r === 3) return w.replace(/drei$/, 'dritte');
  if (r === 7) return w.replace(/sieben$/, 'siebte');
  if (r === 8) return w.replace(/acht$/, 'achte');
  return w + (r > 0 && r < 20 ? 'te' : 'ste');
}

// ---------- Italian ----------
const IT_ONES = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const IT_TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];

function itUnder100(n) {
  if (n < 20) return IT_ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  const tens = u === 1 || u === 8 ? IT_TENS[t].slice(0, -1) : IT_TENS[t]; // ventuno, ventotto
  return u === 3 ? `${tens}tré` : `${tens}${u ? IT_ONES[u] : ''}`;
}

function itUnder1000(n) {
  if (n < 100) return itUnder100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r ? itUnder100(r) : '';
  return `${h === 1 ? '' : IT_ONES[h]}cent${rest.startsWith('o') ? '' : 'o'}${rest}`; // centottanta, centotto
}

function itCardinal(n) {
  if (n < 1000) return itUnder1000(n);
  const parts = [];
  for (const [value, one, many] of [[1e9, 'un miliardo', 'miliardi'], [1e6, 'un milione', 'milioni']]) {
    if (n >= value) {
      const k = Math.floor(n / value);
      parts.push(k === 1 ? one : `${itUnder1000(k)} ${many}`);
      n %= value;
    }
  }
  let word = '';
  if (n >= 1000) {
    const k = Math.floor(n / 1000);
    word = k === 1 ? 'mille' : `${itUnder1000(k)}mila`;
    n %= 1000;
  }
  if (n) word += itUnder1000(n);
  if (word) parts.push(word);
  return parts.join(' ');
}

const IT_ORDINALS = ['', 'primo', 'secondo', 'terzo', 'quarto', 'quinto', 'sesto', 'settimo', 'ottavo', 'nono', 'decimo'];

function itOrdinal(n) {
  if (n <= 10) return IT_ORDINALS[n];
  const w = itCardinal(n);
  if (w.endsWith('tré')) return `${w.slice(0, -3)}treesimo`;
  if (w.endsWith('sei')) return `${w}esimo`;
  if (w.endsWith('mila')) return `${w.slice(0, -4)}millesimo`;
  return `${w.slice(0, -1)}esimo`;
}

// ---------- The languages ----------
const UNITS = {
  en: { m: ['metre', 'metres'], km: ['kilometre', 'kilometres'], 'm²': ['square metre', 'square metres'], 'km²': ['square kilometre', 'square kilometres'], ha: ['hectare', 'hectares'], kg: ['kilo', 'kilos'], ft: ['foot', 'feet'] },
  fr: { m: ['mètre', 'mètres'], km: ['kilomètre', 'kilomètres'], 'm²': ['mètre carré', 'mètres carrés'], 'km²': ['kilomètre carré', 'kilomètres carrés'], ha: ['hectare', 'hectares'], kg: ['kilo', 'kilos'] },
  es: { m: ['metro', 'metros'], km: ['kilómetro', 'kilómetros'], 'm²': ['metro cuadrado', 'metros cuadrados'], 'km²': ['kilómetro cuadrado', 'kilómetros cuadrados'], ha: ['hectárea', 'hectáreas'], kg: ['kilo', 'kilos'] },
  de: { m: ['Meter', 'Meter'], km: ['Kilometer', 'Kilometer'], 'm²': ['Quadratmeter', 'Quadratmeter'], 'km²': ['Quadratkilometer', 'Quadratkilometer'], ha: ['Hektar', 'Hektar'], kg: ['Kilo', 'Kilo'] },
  it: { m: ['metro', 'metri'], km: ['chilometro', 'chilometri'], 'm²': ['metro quadrato', 'metri quadrati'], 'km²': ['chilometro quadrato', 'chilometri quadrati'], ha: ['ettaro', 'ettari'], kg: ['chilo', 'chili'] },
};

// A four-digit number followed by one of these is a count, not a year ("1500 metres").
const COUNTS = {
  en: /^(?:m|km|ft|kg|ha|met(?:re|er)s?|feet|kilomet(?:re|er)s?|people|inhabitants|residents|seats|steps|stairs|rooms|years|hectares|visitors|species|students|tonnes|tons|soldiers|men|women|islands|trees|works|paintings|pieces|objects|books|volumes|graves|columns|windows)$/i,
  fr: /^(?:m|km|kg|ha|mètres?|kilomètres?|habitants?|personnes?|marches?|places?|ans|années?|hectares?|visiteurs?|espèces?|chambres?|œuvres?|tableaux|livres?|tombes?|colonnes?|fenêtres?|pièces?|hommes?|femmes?|soldats?|arbres?)$/i,
  es: /^(?:m|km|kg|ha|metros?|kilómetros?|habitantes?|personas?|escalones?|asientos?|plazas?|años?|hectáreas?|visitantes?|especies?|habitaciones?|obras?|cuadros?|libros?|tumbas?|columnas?|ventanas?|piezas?|hombres?|mujeres?|soldados?|árboles?)$/i,
  de: /^(?:m|km|kg|ha|Metern?|Kilometern?|Einwohner|Menschen|Personen|Stufen|Plätze|Sitzplätze|Jahren?|Hektar|Besucher|Arten|Zimmer|Werke|Gemälde|Bücher|Gräber|Säulen|Fenster|Stücke|Männer|Frauen|Soldaten|Bäume)$/i,
  it: /^(?:m|km|kg|ha|metri|metro|chilometri|chilometro|abitanti|persone|gradini|posti|anni|ettari|visitatori|specie|stanze|camere|opere|dipinti|libri|tombe|colonne|finestre|pezzi|uomini|donne|soldati|alberi)$/i,
};

const LANGS = {
  en: { cardinal: enCardinal, year: enYear, ordinal: enOrdinal, point: 'point', percent: 'percent', to: 'to', decimal: '.', groups: /\b\d{1,3}(?:,\d{3})+\b/g },
  fr: { cardinal: frCardinal, year: frCardinal, ordinal: frOrdinal, point: 'virgule', percent: 'pour cent', to: 'à', decimal: ',', groups: /\b\d{1,3}(?:[.   ]\d{3})+\b/g },
  es: { cardinal: esCardinal, year: esCardinal, ordinal: esOrdinal, point: 'coma', percent: 'por ciento', to: 'a', decimal: ',', groups: /\b\d{1,3}(?:[.   ]\d{3})+\b/g },
  de: { cardinal: deCardinal, year: deYear, ordinal: deOrdinal, point: 'Komma', percent: 'Prozent', to: 'bis', decimal: ',', groups: /\b\d{1,3}(?:[.   ]\d{3})+\b/g },
  it: { cardinal: itCardinal, year: itCardinal, ordinal: itOrdinal, point: 'virgola', percent: 'per cento', to: 'a', decimal: ',', groups: /\b\d{1,3}(?:[.   ]\d{3})+\b/g },
};

/** Regnal numbers and centuries: "Louis XIV", "pont Alexandre-III", "XIVe siècle", "siglo XIV", "Ludwig XIV.". */
function spellRoman(text, lang) {
  let t = text;
  const small = (s) => smallRoman(s);
  if (lang === 'fr') {
    t = t.replace(new RegExp(`\\b(${ROMAN})(er|ère|re|e|ème)\\b`, 'g'), (m, r, suffix) => {
      const n = small(r);
      return n ? frOrdinal(n, /re|ère/.test(suffix)) : m;
    });
  } else if (lang === 'es') {
    t = t.replace(new RegExp(`\\b([Ss]iglos?)\\s+(${ROMAN})\\b`, 'g'), (m, w, r) => {
      const n = small(r);
      return n ? `${w} ${esCardinal(n)}` : m;
    });
  } else if (lang === 'it') {
    t = t.replace(new RegExp(`\\b(${ROMAN})\\s+(secol[oi])\\b`, 'g'), (m, r, w) => {
      const n = small(r);
      return n ? `${itOrdinal(n)} ${w}` : m;
    });
    t = t.replace(new RegExp(`\\b(secolo)\\s+(${ROMAN})\\b`, 'g'), (m, w, r) => {
      const n = small(r);
      return n ? `${w} ${itOrdinal(n)}` : m;
    });
  } else if (lang === 'de') {
    t = t.replace(new RegExp(`\\b(${ROMAN})\\.\\s+(Jahrhundert)`, 'g'), (m, r, w) => {
      const n = small(r);
      return n ? `${deOrdinal(n)}n ${w}` : m;
    });
  }
  // A name, then the numeral (and in German its period, dropped when the sentence goes on).
  const single = lang === 'en' ? /^[VX]$/ : /^[IVX]$/; // "Then I went": never a numeral in English
  const regnal = new RegExp(`(\\p{Lu}[\\p{L}'’]+)(?:\\s+|-)(${ROMAN})(\\.?)(?=[\\s.,;:!?)»”"']|$)(?=(\\s\\p{Ll})?)`, 'gu');
  return t.replace(regnal, (m, name, r, dot, lowerFollows) => {
    const n = small(r);
    if (!n || (r.length === 1 && !single.test(r))) return m;
    let said;
    if (lang === 'en') said = EN_PLAIN_AFTER.test(name) ? enCardinal(n) : `the ${enOrdinal(n)}`;
    else if (lang === 'fr') said = n === 1 ? 'premier' : frCardinal(n);
    else if (lang === 'es') said = esOrdinal(n);
    else if (lang === 'de') said = `der ${capitalize(deOrdinal(n))}`;
    else said = itOrdinal(n);
    const keepDot = dot && !(lang === 'de' && lowerFollows);
    return `${name} ${said}${keepDot ? '.' : ''}`;
  });
}

/** "14th", "1er", "14e", "14.º", "14°", "14. Jahrhundert". */
function spellOrdinals(text, lang) {
  switch (lang) {
    case 'en':
      return text.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, (m, d) => enOrdinal(Number(d)));
    case 'fr':
      return text.replace(/\b(\d+)(er|ère|re|e|ème|èmes|ers|es)\b/g, (m, d, s) => frOrdinal(Number(d), /re|ère/.test(s)));
    case 'es':
      return text.replace(/\b(\d+)\.?[ºª°](?!\p{L})/gu, (m, d) => esOrdinal(Number(d)));
    case 'it':
      return text.replace(/\b(\d+)[ºª°](?!\p{L})/gu, (m, d) => itOrdinal(Number(d)));
    case 'de':
      // A day or a century ("am 14. Juli", "im 19. Jahrhundert"); bigger numbers before a period end a sentence.
      return text.replace(/\b(\d{1,2})\.(?=\s+\p{Lu})/gu, (m, d) => (Number(d) > 0 && Number(d) <= 31 ? `${deOrdinal(Number(d))}n` : m));
    default:
      return text;
  }
}

/**
 * Every number in the text written out in words, in the given language (unknown language:
 * unchanged). Four-digit numbers are said as years unless a count noun or unit follows.
 */
export function spellNumbers(text, lang) {
  const L = LANGS[lang];
  if (!L || !/\d|[IVX]/.test(text)) return text;
  const sep = L.decimal === '.' ? '\\.' : ',';
  const whole = (digits, count = false) => {
    if (digits.length > 12) return digits; // a code, not a number
    const n = Number(digits);
    return !count && digits.length === 4 && n >= 1000 && n <= 2099 ? L.year(n) : L.cardinal(n);
  };
  const decimal = (int, frac) => {
    const byDigit = lang === 'en' || frac.startsWith('0');
    const fraction = byDigit ? [...frac].map((d) => L.cardinal(Number(d))).join(' ') : L.cardinal(Number(frac));
    return `${L.cardinal(Number(int))} ${L.point} ${fraction}`;
  };
  const number = (s, count) => {
    const m = s.match(new RegExp(`^(\\d+)${sep}(\\d+)$`));
    return m ? decimal(m[1], m[2]) : whole(s, count);
  };

  let t = spellRoman(text, lang);
  if (lang === 'en') t = t.replace(/\b(1\d{3}|20\d{2})s\b/g, (m, y) => enDecade(Number(y)));
  if (lang === 'de') t = t.replace(/\b(1\d{3}|20\d{2})er\b/g, (m, y) => `${deYear(Number(y))}er`);
  t = spellOrdinals(t, lang);
  t = t.replace(L.groups, (m) => m.replace(/\D/g, '')); // 1,620,343 / 1 620 343 / 1.620.343
  t = t.replace(new RegExp(`(\\d+(?:${sep}\\d+)?)\\s?%`, 'g'), (m, num) => `${number(num, true)} ${L.percent}`);
  t = t.replace(new RegExp(`(\\d+(?:${sep}\\d+)?)\\s?(km²|m²|km|m|ha|kg|ft)(?!\\p{L})`, 'gu'), (m, num, unit) => {
    const words = UNITS[lang][unit];
    return words ? `${number(num, true)} ${words[num === '1' ? 0 : 1]}` : m;
  });
  t = t.replace(/(\d)\s?[–—]\s?(?=\d)/g, `$1 ${L.to} `).replace(/\b(\d{4})-(?=\d{4}\b)/g, `$1 ${L.to} `); // 1852–1926
  t = t.replace(new RegExp(`(?<!\\d)(\\d+)${sep}(\\d+)(?!\\d)`, 'g'), (m, i, f) => decimal(i, f));
  return t.replace(/(?<![\p{L}\d])(\d+)(?!\d)(?=(\s*\p{L}+)?)/gu, (m, digits, after = '') => {
    const next = after.trim();
    const count = !!next && COUNTS[lang].test(next);
    const glued = after && !/^\s/.test(after); // "3D": keep a space before the letters
    return whole(digits, count) + (glued ? ' ' : '');
  });
}
