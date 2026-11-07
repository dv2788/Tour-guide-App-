// From an encyclopedia article to what a guide would say: the sentences worth hearing, the
// place named the way the listener's language names it, the definition folded into the
// arrival ("You have arrived at Casa Batlló, a building in the centre of Barcelona"), no
// "Catalonia, Spain" tails in a Barcelona walk, and abbreviations, ranges and dashes said
// the way they're read aloud. Five languages; anything else gets the neutral clean-up only.

import { cleanForSpeech, splitSentences } from './text.js';

const LANGS = ['en', 'fr', 'es', 'de', 'it'];

// ---------- Reading aloud ----------
const TO = { en: 'to', fr: 'à', es: 'a', de: 'bis', it: 'a' };
const AND = { en: 'and', fr: 'et', es: 'y', de: 'und', it: 'e' };
const AROUND = { en: 'around', fr: 'vers', es: 'hacia', de: 'etwa', it: 'circa' };
const NUMBER = { en: 'number', fr: 'numéro', es: 'número', de: 'Nummer', it: 'numero' };
const ABBREVIATIONS = {
  en: [
    [/\bSt\.?\s(?=\p{Lu})/gu, 'Saint '],
    [/\be\.g\.,?\s/g, 'for example, '],
    [/\bi\.e\.,?\s/g, 'that is, '],
    [/\bNo\.\s?(?=\d)/g, 'number '],
  ],
  fr: [
    [/\bSt[-\s](?=\p{Lu})/gu, 'Saint-'],
    [/\bSte[-\s](?=\p{Lu})/gu, 'Sainte-'],
    [/\bp\.\s?ex\.\s/g, 'par exemple '],
    [/\bn[°º]\s?(?=\d)/g, 'numéro '],
  ],
  es: [
    [/\bSta\.\s(?=\p{Lu})/gu, 'Santa '],
    [/\bSto\.\s(?=\p{Lu})/gu, 'Santo '],
    [/\bs\.\s?(?=[IVX]+\b)/g, 'siglo '],
    [/\bn\.?[°º]\s?(?=\d)/g, 'número '],
  ],
  de: [
    [/\bSt\.\s(?=\p{Lu})/gu, 'Sankt '],
    [/\bz\.\s?B\.\s/g, 'zum Beispiel '],
    [/\bbzw\.\s/g, 'beziehungsweise '],
    [/\bu\.\s?a\.\s/g, 'unter anderem '],
    [/\bJh\.(?=\s|$)/g, 'Jahrhundert'],
    [/\bNr\.\s?(?=\d)/g, 'Nummer '],
  ],
  it: [
    [/\bsec\.\s?(?=[IVX]+\b)/g, 'secolo '],
    [/\bn\.\s?(?=\d)/g, 'numero '],
  ],
};

/** Ranges, dashes, "&", "c." and common abbreviations as they are said. */
export function expandForSpeech(text, lang = 'en') {
  const l = LANGS.includes(lang) ? lang : 'en';
  let s = text;
  s = s.replace(/(\d)\s?[–—]\s?(?=\d)/g, `$1 ${TO[l]} `); // 1329–1383
  s = s.replace(/\b(\d{4})-(?=\d{4}\b)/g, `$1 ${TO[l]} `); // 1329-1383 (a hyphen between years)
  s = s.replace(/\s[–—]\s/g, ', '); // a dash in the middle of a sentence
  s = s.replace(/\s&\s/g, ` ${AND[l]} `);
  s = s.replace(/\b(?:c|ca)\.\s?(?=\d)/g, `${AROUND[l]} `);
  for (const [re, to] of ABBREVIATIONS[l]) s = s.replace(re, to);
  return s;
}

// ---------- Country tails ----------
const countryNames = new Map(); // lang -> names

/** The names of the world's countries in this language, from the platform's own data. */
export function countriesIn(lang) {
  if (countryNames.has(lang)) return countryNames.get(lang);
  const names = new Set();
  try {
    const display = new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' });
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i) + String.fromCharCode(A + j);
        let name;
        try {
          name = display.of(code);
        } catch {
          continue;
        }
        if (name && name !== code && !/\d/.test(name) && !/^(?:Unknown|Pseudo|World|Europe)/i.test(name)) names.add(name);
      }
    }
  } catch {
    // no Intl.DisplayNames: tails stay
  }
  // Common long forms Wikipedia writes out.
  for (const n of ['United States of America', 'United Kingdom of Great Britain and Northern Ireland', 'Vereinigte Staaten von Amerika', 'États-Unis d’Amérique', 'Estados Unidos de América', 'Stati Uniti d’America']) names.add(n);
  countryNames.set(lang, names);
  return names;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tailRes = new Map();

/**
 * Drop ", Catalonia, Spain" and ", Spain" (or "en Espagne", "in Spanien"…) after a place:
 * a city tour knows what country it's in. The country must end its clause.
 */
export function dropCountryTails(text, lang = 'en') {
  if (!tailRes.has(lang)) {
    const names = [...countriesIn(lang)].sort((a, b) => b.length - a.length).map(escapeRe);
    const prefix = '(?:(?:en|in|im|a|à)\\s+)?';
    tailRes.set(lang, names.length ? new RegExp(`,\\s*${prefix}(?:\\p{Lu}[\\p{L}\\s'’-]{1,40},\\s*)?${prefix}(?:${names.join('|')})(?=[.,;:!?)]|$)`, 'gu') : null);
  }
  const re = tailRes.get(lang);
  return re ? text.replace(re, '') : text;
}

// ---------- Sentences worth hearing ----------
// Sentences that are statistics or administrative geography: nobody wants them read out.
const ADMINISTRATIVE = {
  en: /\b(?:population|census|inhabitants|municipality|municipalities|administrative|autonomous community|comarca|province of|postal code|postcode|zip code|coordinates|metropolitan area|urban area|km²|km2|square (?:kilomet(?:re|er)s|miles)|sq mi|GDP|per capita|as of \d{4}|at the \d{4} census|twinned|sister cit|its address|the address)/i,
  fr: /\b(?:population|recensement|habitants|commune|municipalit|communauté autonome|comarque|chef-lieu|préfecture|code postal|km²|km2|kilomètres carrés|agglomération|aire urbaine|aire métropolitaine|région métropolitaine|PIB|jumelée|jumelage|adresse)/i,
  es: /\b(?:población|censo|habitantes|municipio|municipalidad|comunidad autónoma|comarca|provincia de|código postal|km²|km2|kilómetros cuadrados|área metropolitana|PIB|hermanad|dirección)/i,
  de: /\b(?:Einwohner|Volkszählung|Gemeinde|Landkreis|Regierungsbezirk|Verwaltungssitz|Postleitzahl|km²|km2|Quadratkilometer|Metropolregion|Ballungsraum|Bruttoinlandsprodukt|Partnerstadt|Städtepartnerschaft|Adresse|Hausnummer)/i,
  it: /\b(?:popolazione|censimento|abitanti|comune|comunità autonoma|provincia di|codice postale|km²|km2|chilometri quadrati|area metropolitana|PIL|gemellat|indirizzo)/i,
};
const MAX_SENTENCE = 320; // longer sentences are lists of names and dates: skipped when there's a choice

/**
 * The sentences of an article worth reading aloud, in order: up to `count` of them and about
 * `maxChars` in all, skipping statistics and list-like sentences when something better follows.
 * `text` may hold several paragraphs (newlines).
 */
/** The sentences of a text as they will be read: asides gone, abbreviations expanded first so "St." ends no sentence. */
export function spokenSentences(text, lang = 'en') {
  // The whole text at once: an aside can run across a line break ("(… \n katalanisch …)").
  return splitSentences(expandForSpeech(cleanForSpeech(String(text ?? '')), lang), lang);
}

// "With a population of 1.6 million", "1.731.649 Menschen": a people count is a statistic in any language.
const PEOPLE_COUNT = /\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+\s*(?:people|inhabitants|residents|habitants|personnes|habitantes|personas|Menschen|Einwohner|Bewohner|abitanti|persone)\b|\d(?:[.,]\d+)?\s*(?:million|millions|Millionen|milioni|millones)\s+(?:people|inhabitants|residents|d['’]habitants|habitants|habitantes|personas|Menschen|Einwohner|abitanti|persone)\b/i;

export function storySentences(text, { count = 4, maxChars = 600, lang = 'en', fallback = true } = {}) {
  if (!text) return [];
  const all = spokenSentences(text, lang);
  if (!all.length) return [];
  const admin = ADMINISTRATIVE[lang];
  const good = all.filter((s) => !(admin && admin.test(s)) && !PEOPLE_COUNT.test(s) && s.length <= MAX_SENTENCE && !/^(?:See also|Voir aussi|Véase|Siehe auch|Vedi anche)/i.test(s));
  const pool = good.length ? good : fallback ? all.slice(0, 1) : [];
  const out = [];
  let chars = 0;
  for (const s of pool) {
    if (out.length >= count) break;
    if (out.length && chars + s.length > maxChars) break;
    out.push(s);
    chars += s.length;
  }
  return out;
}

// ---------- The definition sentence ----------
const COPULA = {
  en: /\s(is|are|was)\s/,
  fr: /\s(est|sont|fut|était)\s/,
  es: /\s(es|son|era|fue)\s/,
  de: /\s(ist|sind|war)\s/,
  it: /\s(è|sono|era|fu)\s/,
};
const PRESENT = new Set(['is', 'are', 'est', 'sont', 'es', 'son', 'ist', 'sind', 'è', 'sono']);
const DETERMINER = {
  en: /^(?:a|an|the|one of|two|three)\b/i,
  fr: /^(?:un|une|le|la|l['’]|les|des|l['’]un|l['’]une|l['’]une des|l['’]un des|deux|trois)\b/i,
  es: /^(?:un|una|unos|unas|el|la|los|las|uno de|una de|dos|tres)\b/i,
  de: /^(?:ein|eine|einer|eines|der|die|das|eins der|eine der|einer der|zwei|drei)\b/i,
  it: /^(?:un|una|uno|un['’]|il|la|lo|l['’]|i|gli|le|uno dei|una delle|uno degli|due|tre)\b/i,
};
// The definite article at the start of a name or sentence ("Le Grand Palais…", "L'Arena…").
const DEFINITE = {
  en: /^(the)\s+/i,
  fr: /^(?:(le|la|les)\s+|(l['’])\s*)/i,
  es: /^(el|la|los|las)\s+/i,
  it: /^(?:(il|lo|la|i|gli|le)\s+|(l['’])\s*)/i,
};
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * The article a name takes, from how the article's own text starts: "Le Grand Palais des
 * Champs-Élysées, plus communément appelé…" gives "le Grand Palais"; "The Louvre, or the Louvre
 * Museum, is…" gives "the Louvre". Null when none of the texts starts with the name.
 */
function articleFromText(name, texts, lang) {
  const re = DEFINITE[lang];
  if (!re) return null;
  const wanted = fold(name);
  for (const text of texts) {
    const m = text ? re.exec(text) : null;
    if (!m) continue;
    const rest = fold(text.slice(m[0].length));
    if (rest.startsWith(wanted) && !/\p{L}/u.test(rest.slice(wanted.length, wanted.length + 1))) return m[0].trim().toLowerCase();
  }
  return null;
}

const ARTICLES = {
  en: /^(?:the|a|an)\s/i,
  fr: /^(?:le|la|les|l['’]|un|une)\s?/i,
  es: /^(?:el|la|los|las|un|una)\s/i,
  it: /^(?:il|lo|la|l['’]|i|gli|le|un|una|uno)\s?/i,
  de: /^(?:der|die|das|ein|eine)\s/i,
};

/**
 * "Casa Batlló is a building in the centre of Barcelona." -> { subject, name, tail, present }:
 * the thing, its short name (the subject before any aside), and what it is. Null when the
 * sentence isn't a definition (no copula early on, or not followed by a noun phrase).
 */
export function splitDefinition(sentence, lang = 'en') {
  const copula = COPULA[lang];
  if (!copula || !sentence) return null;
  const head = sentence.slice(0, 220);
  const m = copula.exec(head);
  if (!m || m.index < 2) return null;
  const subject = sentence.slice(0, m.index).trim();
  const tail = sentence.slice(m.index + m[0].length).trim();
  if (!subject || subject.length > 180 || !/^\p{Lu}/u.test(subject) || !DETERMINER[lang].test(tail)) return null;
  const name = subject.split(/,\s|\s[–—]|\s\(/)[0].replace(/[,;:\s]+$/, '').trim();
  return { subject, name, tail: tail.replace(/\.$/, ''), present: PRESENT.has(m[1]) };
}

/**
 * Fold a definition into the sentence that names the place: "You have arrived at Casa Batlló."
 * + "Casa Batlló is a building…" -> "You have arrived at Casa Batlló, a building…". German
 * keeps the nominative after a colon. Returns null when the sentence doesn't end with the
 * name or isn't a present-tense definition.
 */
export function mergeDefinition(intro, sentence, name, lang = 'en') {
  const def = splitDefinition(sentence, lang);
  if (!def || !def.present) return null;
  const base = intro.replace(/[.!]\s*$/, '');
  const lower = base.toLowerCase();
  const named = name.toLowerCase();
  if (lang === 'de') return lower.includes(named) ? `${base}: ${def.tail}.` : null;
  return lower.endsWith(named) ? `${base}, ${def.tail}.` : null;
}

// ---------- Names in the listener's language ----------
// What a place is, with its article, so a title can be said naturally ("la cathédrale…").
const TYPES = {
  fr: { la: 'cathédrale basilique église abbaye chapelle place tour gare porte statue fontaine halle rue avenue bibliothèque université mairie citadelle forteresse synagogue mosquée casa médersa médina kasbah koubba nécropole colonne grotte', le: 'musée palais marché château pont jardin parc théâtre monastère temple port arc cimetière quartier boulevard mémorial stade monument cloître couvent phare souk mausolée sanctuaire fort', "l'": 'hôtel opéra hôtel-de-ville amphithéâtre aqueduc observatoire île', les: 'tombeaux jardins halles arènes thermes' },
  es: { la: 'catedral basílica iglesia abadía capilla plaza torre estación puerta estatua fuente calle avenida biblioteca universidad ciudadela fortaleza sinagoga mezquita catedral-basílica muralla alcazaba casa ermita necrópolis columna', el: 'museo palacio mercado castillo puente jardín parque teatro monasterio templo puerto arco cementerio barrio paseo monumento claustro convento faro hotel ayuntamiento anfiteatro acueducto observatorio alcázar obelisco cabildo mausoleo santuario mirador zócalo fuerte', las: 'ruinas murallas termas', los: 'jardines baños' },
  it: { la: 'cattedrale basilica chiesa abbazia cappella piazza torre stazione porta statua fontana via biblioteca università cittadella fortezza sinagoga moschea galleria villa loggia casa rocca colonna necropoli', il: 'museo palazzo mercato castello ponte giardino parco teatro monastero tempio porto cimitero quartiere corso monumento chiostro convento faro duomo battistero santuario foro mausoleo', "l'": 'hotel arco anfiteatro acquedotto osservatorio isola ospedale arena', le: 'terme mura rovine', i: 'giardini' },
  de: { die: 'kathedrale basilika kirche abtei kapelle burg brücke statue straße allee bibliothek universität zitadelle festung synagoge moschee oper halle galerie villa altstadt säule nekropole', der: 'dom palast markt turm garten park bahnhof brunnen tempel hafen bogen friedhof platz leuchtturm obelisk', das: 'museum schloss theater kloster tor viertel rathaus denkmal stadion hotel amphitheater aquädukt observatorium mausoleum forum' },
};
// English names that take "the": by their first word ("Palace of…", "Place de…") or their last ("… Tower").
const EN_THE_FIRST = /^(?:palace|museum|cathedral|church|basilica|temple|tower|castle|statue|tomb|tombs|house|gardens?|palais|palau|palacio|palazzo|place|plaza|plaça|piazza|platz|pont|ponte|puente|porta|puerta|porte|musée|museo|museu|mercat|mercado|mercato|torre|tour|arc|arco|fontana|fuente|fontaine|château|castillo|castello|église|iglesia|chiesa|cathédrale|catedral|cattedrale|basilique|basílica|mezquita|mosquée|teatro|théâtre|cabildo|obelisco|jardin|jardín|jardins|giardino|monumento|monument|mausoleo|mausoleum|galleria|galerie|loggia|duomo|chapel|chapelle|capilla|cappella|abbey|abbaye|cloister|convent|convento|forum|foro|terme|thermes|arena|colonna|columna|cimetière|cementerio|cimitero|bourse|opéra)\b/i;
const EN_THE_LAST = /\b(?:tower|bridge|palace|museum|gate|castle|basilica|mosque|madrasa|monument|memorial|arch|fountain|library|observatory|tombs?|synagogue|pagoda|aqueduct|amphitheatre|amphitheater|obelisk|lighthouse|opera house|concert hall|town hall|city hall|cemetery|necropolis|mausoleum|citadel|fortress|fort|gardens|abbey|monastery|convent|chapel|cloister|colonnade|arcade|pavilion|aquarium|planetarium|statue|column|stadium|arena|forum|baths|pier|quay|embankment|promenade|market hall|exchange|mint|palais|palau|basílica|basilique|catedral|cathédrale|cattedrale|mezquita|mosquée|museo|musée|museu|teatro|théâtre)$/i;
const EN_NO_THE = /^(?:the|a|an|la|le|les|el|los|las|il|lo|i|gli|der|die|das|saint|st\.?|san|santa|santo|sant['’]|sainte?|mount|lake|old|new|east|west|north|south|upper|lower)\b/i;
const typeArticle = new Map();
function articleFor(word, lang) {
  if (!typeArticle.has(lang)) {
    const map = new Map();
    for (const [article, words] of Object.entries(TYPES[lang] ?? {})) for (const w of words.split(' ')) map.set(w, article);
    typeArticle.set(lang, map);
  }
  return typeArticle.get(lang).get(word.toLowerCase()) ?? null;
}

/** "Royal Square (Barcelona)" -> "Royal Square". */
export const plainTitle = (title) => String(title ?? '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^(?:Ville de|City of|Ciudad de|Città di|Stadt)\s+/i, '').trim();

/**
 * How the guide says a place's name in its language. The traveller's own name for a stop stays
 * unless the article in this language calls it something else entirely (a French walk through
 * "Barcelona Cathedral" says "la cathédrale Sainte-Croix de Barcelone"): then the article's
 * own words, with the article's definition subject when it is short, else the title with the
 * article its kind takes.
 */
const SMALL_WORDS = new Set(['the', 'and', 'of', 'de', 'du', 'des', 'la', 'le', 'les', 'el', 'los', 'las', 'der', 'die', 'das', 'di', 'del', 'della', 'dei', 'degli', 'delle', 'et', 'und', 'von', 'zu', 'da', 'al', 'am', 'im']);
const words = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !SMALL_WORDS.has(w));

/** "Eiffel Tower" -> "the Eiffel Tower"; "Place de la Concorde" -> "the Place de la Concorde"; "Jemaa el-Fna" stays. */
export function englishName(name) {
  const n = String(name ?? '').trim();
  if (!n || EN_NO_THE.test(n) || !/^\p{Lu}/u.test(n)) return n;
  return EN_THE_FIRST.test(n) || EN_THE_LAST.test(n) ? `the ${n}` : n;
}

export function spokenName(name, { title, firstSentence, ignore = '', preferTitle = false } = {}, lang = 'en') {
  const given = String(name ?? '').trim();
  if (lang === 'en') {
    const said = preferTitle ? given : englishName(given);
    // "Louvre": English says "the Louvre", and its article's first words do too.
    if (said === given && !preferTitle && !ARTICLES.en.test(given) && articleFromText(given, [firstSentence], 'en')) return `the ${given}`;
    return said;
  }
  if (!title) return given;
  const own = plainTitle(title);
  const skip = new Set(words(ignore).map(fold)); // the city's name is in many titles: it says nothing
  const tokens = (s) => words(s).map(fold).filter((w) => !skip.has(w)); // "María" and "Maria" are one word
  const def = !preferTitle && firstSentence ? splitDefinition(cleanForSpeech(firstSentence), lang) : null;
  const known = new Set([...tokens(own), ...(def ? tokens(def.name) : [])]);
  // "Eiffel Tower" in French, "Barcelona Cathedral" in German: a word the article never uses
  // means the traveller's name is a translation; say it as the article does.
  const foreign = tokens(given).some((w) => !known.has(w));
  let said;
  if (!foreign) said = given;
  else if (def && def.name.length <= 60 && tokens(def.name).some((w) => tokens(own).includes(w))) said = def.name;
  else said = own;
  if (ARTICLES[lang]?.test(said)) return said[0].toLowerCase() + said.slice(1);
  const first = said.split(/[\s-]/)[0];
  const join = (article, rest) => (/['’]$/.test(article) ? `${article}${rest}` : `${article} ${rest}`);
  const article = articleFor(first, lang);
  if (article) return join(article, said);
  // Not a kind of place, but the article's own text starts with an article and this name
  // ("Le Grand Palais…", "L'Arena di Verona è…"): say it that way.
  const fromText = articleFromText(said, [def?.name, def?.subject, firstSentence ? cleanForSpeech(firstSentence) : '', own], lang);
  if (fromText) return join(fromText, said);
  // "Louvre": the article calls it "Le musée du Louvre"; a short name of the article's that
  // contains the traveller's, with its article, is how a local says it ("au musée du Louvre").
  if (def && DEFINITE[lang]?.test(def.name) && def.name.length <= 60) {
    const inside = new RegExp(`(?<!\\p{L})${fold(said).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u');
    if (inside.test(fold(def.name)) && words(def.name).length <= words(said).length + 3) return def.name[0].toLowerCase() + def.name.slice(1);
  }
  return said;
}

/** "à le musée" -> "au musée", "a el palacio" -> "al palacio", "bei dem Dom" -> "beim Dom"… */
export function contractArticles(text, lang = 'en') {
  switch (lang) {
    case 'fr':
      return text
        .replace(/(?<!\p{L})à le(?!\p{L})/gu, 'au')
        .replace(/(?<!\p{L})à les(?!\p{L})/gu, 'aux')
        .replace(/(?<!\p{L})de le(?!\p{L})/gu, 'du')
        .replace(/(?<!\p{L})de les(?!\p{L})/gu, 'des');
    case 'es':
      return text.replace(/\ba el\b/g, 'al').replace(/\bde el\b/g, 'del');
    case 'it':
      return text
        .replace(/\ba il\b/g, 'al')
        .replace(/\ba lo\b/g, 'allo')
        .replace(/\ba la\b/g, 'alla')
        .replace(/\ba l(['’])/g, 'all$1')
        .replace(/\ba i\b/g, 'ai')
        .replace(/\ba gli\b/g, 'agli')
        .replace(/\ba le\b/g, 'alle')
        .replace(/\bdi il\b/g, 'del')
        .replace(/\bdi la\b/g, 'della');
    case 'de':
      return text
        .replace(/\bbei die\b/g, 'bei der')
        .replace(/\bbei der (\p{Lu}\p{L}*)/gu, (m, noun) => (articleFor(noun, 'de') === 'der' ? `beim ${noun}` : m)) // "bei der Dom" (masculine) -> "beim Dom"
        .replace(/\bbei (?:der|das|dem)\b/g, (m) => (m === 'bei der' ? m : 'beim'))
        .replace(/\bzu dem\b/g, 'zum')
        .replace(/\bzu der\b/g, 'zur');
    default:
      return text;
  }
}

/** Everything above, for one piece of narration: expansions, country tails, contractions. */
export function polish(text, lang = 'en') {
  return contractArticles(expandForSpeech(dropCountryTails(text, lang), lang), lang)
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
