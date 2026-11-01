// "Suggest a route for me": the most historically interesting places around you that fit
// in the time you have, in a sensible order, with museum visits and food/drink breaks.
// Pure functions (no network) so they can be tested; app.js fetches the data.

import { distanceMeters } from './geo.js';
import { sharesNameToken } from './text.js';
import { openDuring } from './openingHours.js';

// Kinds of places that carry history, in the five supported languages (word starts).
const HISTORIC_WORDS = [
  // English
  'church', 'cathedral', 'basilica', 'chapel', 'abbey', 'monaster', 'convent', 'temple', 'mosque', 'synagogue', 'shrine',
  'palace', 'castle', 'château', 'chateau', 'fort', 'citadel', 'tower', 'gate', 'city wall', 'ruin', 'archaeolog',
  'ancient', 'roman', 'medieval', 'historic', 'heritage', 'monument', 'memorial', 'statue', 'opera', 'theatre',
  'theater', 'bridge', 'square', 'market', 'old town', 'mausoleum', 'tomb', 'cemetery', 'obelisk', 'triumphal',
  'fountain', 'lighthouse', 'mansion', 'manor',
  // French
  'église', 'eglise', 'cathédrale', 'basilique', 'chapelle', 'abbaye', 'monastère', 'couvent', 'mosquée', 'palais',
  'forteresse', 'citadelle', 'rempart', 'ruines', 'archéolog', 'antique', 'romain', 'médiéval', 'historique',
  'mémorial', 'opéra', 'théâtre', 'pont', 'marché', 'mausolée', 'cimetière', 'obélisque', 'fontaine', 'phare',
  // Spanish
  'iglesia', 'catedral', 'basílica', 'capilla', 'abadía', 'monasterio', 'convento', 'templo', 'mezquita', 'sinagoga',
  'palacio', 'castillo', 'fortaleza', 'ciudadela', 'torre', 'puerta', 'muralla', 'ruinas', 'arqueológ', 'antiguo',
  'histórico', 'monumento', 'estatua', 'teatro', 'puente', 'plaza', 'mercado',
  // German
  'kirche', 'kathedrale', 'münster', 'basilika', 'kapelle', 'abtei', 'kloster', 'moschee', 'synagoge', 'palast',
  'schloss', 'burg', 'festung', 'zitadelle', 'turm', 'stadtmauer', 'ruine', 'archäolog', 'antik', 'römisch',
  'mittelalter', 'historisch', 'denkmal', 'mahnmal', 'oper', 'brücke', 'platz', 'markt',
  // Italian
  'chiesa', 'cattedrale', 'duomo', 'cappella', 'abbazia', 'monastero', 'tempio', 'moschea', 'palazzo', 'castello',
  'fortezza', 'cittadella', 'porta', 'mura', 'rovine', 'archeolog', 'antico', 'medievale', 'storico', 'statua',
  'ponte', 'piazza', 'mercato',
];
const HISTORIC_RE = new RegExp(`(?:^|[^\\p{L}])(?:${HISTORIC_WORDS.join('|')})`, 'iu');
const MUSEUM_RE = /(?:^|[^\p{L}])(?:museum|musée|musee|museo|museu|gallery|galerie|galleria|pinacoteca|kunsthalle)/iu;
// Long articles about whole areas, rivers or streets aren't places you stop at.
// Matched against what a place *is* (the start of its description: "river in France",
// "arrondissement of Paris"), not words further on ("bridge over the river").
const AREA_RE =
  /^(?:[\p{L}'’-]+\s+){0,2}(?:arrondissement|district|neighbou?rhood|suburb|area|space|point|junction|intersection|settlement|ville|cité|région|región|regione|provincia|département|departamento|bundesland|ciudad|stadt|città|comune|gemeinde|île|isla|insel|isola|barrio|bairro|stadtteil|quartiere|rione|quarter|quartier|borough|ward|commune|municipality|municipio|municipalité|city|town|village|capital|river|fleuve|rivière|río|fluss|fiume|lake|region|province|department|département|metropolitan|island|street|avenue|boulevard|rue|calle|straße|strasse|metro line|railway line|prefecture|canton|strait|estuary|bay|lagoon|gulf|canal|former name|historical name|old name|(?<!united\s)states|thoroughfare|sektor|sector|secteur|country|sovereign state|civil parish|business district)(?![\p{L}])/iu;
// "Innermost part of London", "Southern part of Manhattan" (but "Scottish National Gallery: Part of
// National Galleries Scotland" is a gallery).
const PART_OF_RE = /^(?:[\p{L}'’-]+\s+){0,2}part(?![\p{L}])/iu;

// …but a town's buildings are places: "City hall in Bruges", "hôtel de ville à Bruxelles",
// "City walls in Edinburgh", "ehemaliges Wiener Stadttor".
const TOWN_BUILDING_RE =
  /^(?:[\p{L}'’-]+\s+){0,3}(?:town hall|city hall|hôtel de ville|casa consistorial|ayuntamiento|rathaus|stadhuis|palazzo (?:comunale|civico)|(?:city|town) (?:gate|walls?)|stadtmauer|stadttor|porte de ville|puerta de la ciudad|porta della città)(?![\p{L}])/iu;

// Wikipedia also places organisations, events and works at an address: not places to walk to.
// (Matched on the short description: "British intelligence agency", "Satirical magazine", "Fire in 1666".)
const NOT_A_PLACE_RE =
  /(?:^|[^\p{L}])(?:agency|company|corporation|government|body|conglomerate|firm|manufacturer|magazine|newspaper|tabloid|broadcaster|publisher|record label|band|political party|parliament|legislat|senate|ministry|government department|central bank|stock exchange|securities exchange|university|college|school|religious order|higher education|research institution|educational institution|école|ecole|lycée|escuela|schule|scuola|society|association|organi[sz]ation|charity|foundation|club|team|brand|fashion house|retailer|airline|television|radio|channel|film|novel|album|song|video game|battle|siege|attack|assault|incident|affair|arson|explosion|bombing|storming|uprising|insurrection|rebellion|revolt|coup|protest|riot|election|treaty|festival|event|olympics|games|championship|tournament|competition|conflagration|massacre|scandal|police|intelligence|embassy|consulate|series|former (?:country|state)|historical (?:country|state)|christmas tree|christmas market)(?![\p{L}])/iu;
// The same in French, Spanish, German and Italian (descriptions come in the reader's language).
const NOT_A_PLACE_INTL_RE =
  /(?:^|[^\p{L}])(?:épisode|événement|evento|acontecimiento|ereignis|agence|agencia|agentur|agenzia|académies?|academias?|akademien?|accademi[ae]|entreprise|société|journal|quotidien|parti politique|ministère|gouvernement|université|banque|association|fondation|attentat|bataille|incendie|siège|émeute|traité|conférence|élection|jeux olympiques|libération|manifestation|empresa|periódico|partido político|ministerio|gobierno|universidad|banco|fundación|asociación|atentado|batalla|incendio|asedio|motín|tratado|conferencia|elecciones|juegos olímpicos|unternehmen|zeitung|partei|ministerium|regierung|universität|verein|stiftung|anschlag|schlacht|belagerung|aufstand|vertrag|konferenz|olympische|azienda|società|giornale|partito|ministero|governo|università|banca|fondazione|associazione|attentato|battaglia|assedio|rivolta|trattato|conferenza|elezioni|olimpiadi|giochi olimpici|sapin de noël|marché de noël|árbol de navidad|mercado navideño|mercadillo navideño|albero di natale|mercatino di natale|weihnachtsbaum|weihnachtsmarkt|christkindlmarkt)(?![\p{L}])/iu;
// What a place *is* (the first words of its description) when that's an institution or a group,
// not a building: "British think tank", "Scotland's national academy of science", "réseau
// d'universités européennes", "national church of Scotland", "cámara baja de las Cortes".
// (Anchored: "cathedral of the Diocese of Bruges" is still a cathedral.)
const NOT_A_PLACE_START_RE =
  /^(?:[\p{L}'’-]+\s+){0,3}(?:think tank|academy|national church|denomination|(?:arch)?diocese|(?:archi)?diocèse|(?:arqui|archi)?diócesis|(?:arci)?diocesi|(?:erz)?bistum|(?:erz)?diözese|network|réseau|red de|netzwerk|rete di|parlement|parlamento|parlament|lower house|upper house|chambre basse|chambre haute|cámara baja|cámara alta|camera bassa|camera alta|unterhaus|oberhaus|juridiction|tribunal|famine|epidemic|pandemic|hambruna|hungersnot|carestia|épidémie|epidemia|entity|entité|entidad|ente|producer|producteur|productor|produttore|distributeur|operator|opérateur|operador|hersteller|konzern|hypothèse|strategic plan|military plan)(?![\p{L}])/iu;
// Assemblies, by their first words only: "unicameral legislature", "órgano legislativo" (but
// "building housing the legislative assembly" is a building).
const LEGISLATURE_RE = /^(?:[\p{L}'’-]+\s+){0,2}(?:legislat|législat)\p{L}*/iu;
// Institutions named after what they are, with no description to go on (many articles have none).
const INSTITUTION_TITLE_RE = new RegExp(
  [
    '^(?:parliament|government|ministry|house of (?:lords|commons|representatives)|senate|congress|principality|kingdom|duchy|county|republic|empire|province|diocese|archdiocese) of\\b',
    // National churches and dioceses, in the five languages.
    "^(?:roman )?catholic church in\\b|^church of (?:england|scotland|ireland|wales|sweden|norway|denmark|finland|greece)\\b|^(?:römisch-)?katholische kirche in\\b|^evangelische kirche in\\b|^église catholique (?:en|au|aux|de)\\b|^iglesia católica en\\b|^chiesa cattolica in\\b",
    "^(?:archi)?diocèse d|^(?:arqui|archi)?diócesis d|^(?:arci)?diocesi d|^(?:erz)?bistum |^(?:erz)?diözese ",
    // Assemblies and courts (their buildings have their own articles: Palais Bourbon, Reichstag).
    "^chambre des (?:représentants|députés)|^chamber of (?:representatives|deputies)|^cámara de (?:diputados|representantes)|^camera dei deputati|^cour d'(?:assises|appel)|^tribunal (?:de grande instance|judiciaire|administratif|de commerce)",
  ].join('|'),
  'iu',
);
// Events named after what happened: "Battle of Waterloo", "Bataille d'Argentovaria", "Great Fire of
// London", and years: "1973 UCI Cyclo-cross World Championships", "2019 fire at Notre-Dame".
const EVENT_TITLE_RE =
  /^(?:(?:battle|siege|sack|great fire|fire|massacre|bombing|treaty|peace|council|liberation) of\b|(?:bataille|siège|sac|incendie|massacre|bombardement|traité|paix|libération|concile) d(?:e|u|es|’|')|(?:batalla|sitio|asedio|saqueo|incendio|masacre|bombardeo|tratado|paz) de\b|(?:schlacht|belagerung|frieden|vertrag) (?:von|bei|um)\b|(?:battaglia|assedio|sacco|incendio|strage|trattato|pace) d)/iu;
const EVENT_DESCRIPTION_RE = /^\d{3,4}\s/; // "2019 structural fire in Paris" (not "1920s building")
// A title that starts with a year: "2020 Summer Olympics opening ceremony" (but "1000 De La
// Gauchetière" is a skyscraper at that address: see STRUCTURE_RE).
const YEAR_TITLE_RE = /^\d{4}\s/;
const STRUCTURE_RE = /skyscraper|gratte-ciel|rascacielos|grattacielo|hochhaus|wolkenkratzer|building|bâtiment|édifice|immeuble|edificio|gebäude|tower|tour|torre|turm/iu;
// …or by their last word: "Hōgen rebellion", "Great Kantō earthquake", "2015 Paris attacks".
const EVENT_TITLE_END_RE = /(?:^|\s)(?:rebellion|uprising|revolt|riots?|massacre|disaster|earthquake|bombings?|attacks?|incident|affair|crisis|protests?|war|siege|shooting|hostage crisis|famine|plague|epidemic|pandemic|flood)(?:\s*\(.*\))?$/iu;
// Organisations by their first word: "Asociación del Fútbol Argentino", "Fédération française…".
const ORGANISATION_TITLE_RE = /^(?:association|asociación|associazione|fédération|federación|federazione|confederación|verband|bund deutscher|organisation|organization|organización|organizzazione|comité|committee|comitato|komitee)(?![\p{L}])|(?:^|[^\p{L}])(?:university|université|universidad|università|universität|universitat)(?![\p{L}])/iu;
// German packs it into one word: "Tageszeitung", "Maschinenbauunternehmen", "Musikfestival".
const NOT_A_PLACE_DE_RE = /\p{L}(?:unternehmen|zeitung|partei|verein|stiftung|verband|konzern|hersteller|festival)(?![\p{L}])/iu;
// Dates in the title: "World Trade Center (1973–2001)" is the one that stood there then.
const GONE_TITLE_RE = /\(\s*\d{3,4}\s*[–-]\s*\d{3,4}\s*\)\s*$/;
// Descriptions of streets in the five languages ("voie parisienne", "strada di Roma",
// "Einkaufsstraße in Wien", "bulevar y paseo de Madrid").
const STREETISH_RE =
  /^(?:[\p{L}'’-]+\s+){0,2}(?:street|road|avenue|boulevard|thoroughfare|voie|rue|strada|via|calle|avenida|bulevar|paseo|rua|gasse)(?![\p{L}])|^\S*(?:straße|strasse|gasse)(?![\p{L}])/iu;
// Streets are walked along, not stopped at (their stories come up as you walk them).
const STREET_TITLE_RE =
  /^(?:rue|avenue|boulevard|calle|carrer|avinguda|avenida|paseo|passeig|via|viale|corso|rua)\s|(?:straße|strasse|gasse|street|road|lane)(?:\s*\(.*\))?$/iu;
// Places that are gone: "Royal palace in Paris (1564–1883)", "Government of France from 1792 to 1804",
// "1918–1992 country in Central Europe".
const GONE_RE = /\(\s*\d{3,4}\s*[–-]\s*\d{3,4}\s*\)|^\d{3,4}\s*[–-]\s*\d{3,4}\s|\bfrom \d{3,4} to \d{3,4}\b|(?:^|[^\p{L}])(?:demolished|destroyed|détruit|démoli|disparu|destruido|demolido|zerstört|abgerissen|distrutto|demolito)/iu;
// Objects inside a collection ("Ancient Greek sculptures held in London"): the museum is the stop.
const IN_A_COLLECTION_RE =
  /^(?:painting|portrait|manuscript|tapestry|artwork|tableau|peinture|retable|manuscrit|tapisserie|cuadro|pintura|retablo|manuscrito|tapiz|gemälde|handschrift|dipinto|manoscritto|arazzo)(?![\p{L}])|\b(?:held|housed|kept|displayed|exhibited) (?:in|at|by)\b/iu;
// Coordinate kinds (from Wikipedia's {{coord}}) that are never a stop on a walk.
const NOT_A_STOP_TYPES = new Set(['country', 'state', 'adm1st', 'adm2nd', 'adm3rd', 'city', 'event', 'edu', 'airport', 'waterbody', 'river', 'mountain', 'satellite', 'glacier', 'pass', 'forest']);

/** 'museum' | 'historic' | 'sight' */
export function placeKind(poi) {
  const text = `${poi.title ?? ''} ${poi.description ?? ''}`;
  if (MUSEUM_RE.test(text)) return 'museum';
  if (HISTORIC_RE.test(text)) return 'historic';
  return 'sight';
}

/**
 * Whether an article is about something you can go and see, whatever its fame: not an area or
 * street, an organisation, an event, an artwork inside a collection, or a building that's gone.
 * (Also used by "Point your camera", so it labels what's in front of you, not "Notre-Dame fire".)
 */
export function isPlaceToSee(poi) {
  if (poi.category === 'skip' || poi.disambiguation || poi.gone) return false;
  const description = poi.description ?? '';
  const title = poi.title ?? '';
  if ((AREA_RE.test(description) && !TOWN_BUILDING_RE.test(description)) || NOT_A_PLACE_RE.test(description) || NOT_A_PLACE_INTL_RE.test(description) || NOT_A_PLACE_START_RE.test(description)) return false;
  // An assembly, unless it's its building ("edificio legislativo": Argentina's Palace of Congress).
  if (LEGISLATURE_RE.test(description) && !STRUCTURE_RE.test(description) && !HISTORIC_RE.test(title)) return false;
  if (IN_A_COLLECTION_RE.test(description) || GONE_RE.test(description) || NOT_A_PLACE_DE_RE.test(description)) return false;
  // "2019 structural fire in Paris" is an event; "1973 Thames road bridge" is London Bridge.
  if (EVENT_DESCRIPTION_RE.test(description) && !HISTORIC_RE.test(description) && !MUSEUM_RE.test(description)) return false;
  if (INSTITUTION_TITLE_RE.test(title) || EVENT_TITLE_RE.test(title)) return false;
  if (YEAR_TITLE_RE.test(title) && !STRUCTURE_RE.test(description) && !HISTORIC_RE.test(description) && !MUSEUM_RE.test(description)) return false;
  // "Museum of the Second World War", "University Church": the title names a place to see.
  const namesAPlace = MUSEUM_RE.test(title) || HISTORIC_RE.test(title);
  if (PART_OF_RE.test(description) && !namesAPlace && !MUSEUM_RE.test(description) && !HISTORIC_RE.test(description)) return false;
  if (!namesAPlace && (ORGANISATION_TITLE_RE.test(title) || EVENT_TITLE_END_RE.test(title))) return false;
  // Named like a street and nothing says otherwise: a street. Not an address ("10 Downing
  // Street"), an arch ("Rua Augusta Arch": triumphal arch) or a stadium ("Loftus Road").
  if (STREET_TITLE_RE.test(title) && !/^\d/.test(title) && (!description || STREETISH_RE.test(description))) return false;
  if (GONE_TITLE_RE.test(title) || NOT_A_STOP_TYPES.has(poi.coordType)) return false;
  // A railway station counts only when it's a landmark in its own right (Grand Central, St Pancras).
  if (poi.coordType === 'railwaystation' && (poi.langs ?? 0) < 40) return false;
  return true;
}

/**
 * How worth visiting a place is. Fame first: how many Wikipedia languages have an article
 * about it (the Sagrada Família ~95, a neighbourhood church ~5). Then how much there is to
 * tell (article length), and a nudge for historic places and museums. Areas, streets,
 * organisations, events, buildings that are gone and filler are excluded.
 */
export function interestScore(poi) {
  if (!isPlaceToSee(poi)) return -Infinity;
  if ((poi.length ?? 3000) < 2500) return -Infinity; // a stub: too little to tell
  const story = Math.log10(Math.max(1000, poi.length ?? 3000)); // ~3.4 (short) to ~5.3 (major landmark)
  // Without the language count (older data), the article length stands in for fame.
  let score = poi.langs != null ? 1.8 * Math.log10(1 + poi.langs) + 0.4 * story : story;
  const kind = placeKind(poi);
  if (kind === 'historic') score += 0.5;
  if (kind === 'museum') score += 0.6;
  if (poi.thumbnail) score += 0.2;
  if (poi.category === 'minor') score -= 1.5;
  return score;
}

// Below this score a place adds next to nothing to a walk (see interestScore's range).
const SCORE_FLOOR = 3.3;

/** Travel pace for planning: speed, time spent at an ordinary stop, and how much longer streets are than a straight line. */
export const PACE = {
  walk: { kmh: 4.5, dwell: 5, detour: 1.3 },
  run: { kmh: 9, dwell: 1, detour: 1.3 },
  cycle: { kmh: 14, dwell: 3, detour: 1.3 },
  drive: { kmh: 22, dwell: 3, detour: 1.4 },
};

export const DURATIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: 'Half day' },
  { minutes: 480, label: 'Full day' },
];

/** How far to look for places: you can only go so far and come back in the time. */
export function searchRadiusFor(modeId, minutes) {
  const pace = PACE[modeId] ?? PACE.walk;
  const reach = (pace.kmh * 1000 * (minutes / 60)) / 3;
  return Math.round(Math.min(10000, Math.max(600, reach)));
}

/** Museums worth going inside, depending on how long you're out (never while running). */
export function museumVisits(modeId, minutes) {
  if (modeId === 'run') return { count: 0, minutes: 0 };
  if (minutes >= 420) return { count: 2, minutes: 75 };
  if (minutes >= 210) return { count: 1, minutes: 60 };
  if (minutes >= 110) return { count: 1, minutes: 45 };
  return { count: 0, minutes: 0 };
}

// ---------- Food and drink breaks ----------

// `kinds`: OpenStreetMap amenities, best fit first (a restaurant for lunch, a café if there's none).
export const BREAKS = {
  coffee: { minutes: 20, kinds: [['cafe']] },
  lunch: { minutes: 60, kinds: [['restaurant'], ['cafe']] },
  drink: { minutes: 30, kinds: [['bar', 'pub'], ['cafe']] },
  dinner: { minutes: 75, kinds: [['restaurant']] },
};
const amenitiesFor = (meal) => (BREAKS[meal]?.kinds ?? [['cafe']]).flat();

/** What kind of break fits this time of day. */
export function mealAt(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 11.75 && h < 14.25) return 'lunch';
  if (h >= 19 && h < 21.5) return 'dinner';
  if (h >= 17 || h < 6) return 'drink';
  return 'coffee';
}

/**
 * When to take breaks, from when you start and how long you're out. Meals happen at meal
 * times (lunch 12:30, dinner 19:45) if you're out then; coffee or drink breaks (about one
 * per 2½ hours) go in the longest stretches without a break.
 */
export function breakSchedule(start, minutes) {
  const startHour = start.getHours() + start.getMinutes() / 60;
  const out = [];
  // Meals at the usual time, or as close to it as the outing allows (never in the first or
  // last half hour), as long as it's still a sensible hour for that meal.
  for (const [meal, [hour, earliest, latest]] of [['lunch', [12.5, 11.75, 14]], ['dinner', [19.75, 19, 21.5]]]) {
    const shift = (hour - startHour) * 60 < -12 * 60 ? 24 * 60 : 0; // tonight's dinner when starting after midnight
    const m = (hour - startHour) * 60 + shift;
    const lo = Math.max(30, (earliest - startHour) * 60 + shift);
    const hi = Math.min(minutes - 30, (latest - startHour) * 60 + shift);
    // Only when the outing has room for the meal and at least an hour of sightseeing: an hour's
    // walk at dinner time is a walk, not a dinner that leaves no time for anything else.
    const roomy = minutes >= BREAKS[meal].minutes + 60;
    if (lo <= hi && roomy) out.push({ atMinute: Math.round(Math.min(Math.max(m, lo), hi)), meal, minutes: BREAKS[meal].minutes });
  }
  const extra = Math.max(0, Math.round(minutes / 150) - out.length);
  for (let k = 0; k < extra; k++) {
    let best = null;
    let prevEnd = 0;
    for (const b of [...out].sort((a, c) => a.atMinute - c.atMinute).concat({ atMinute: minutes, minutes: 0 })) {
      const gap = b.atMinute - prevEnd;
      if (!best || gap > best.gap) best = { gap, from: prevEnd };
      prevEnd = b.atMinute + b.minutes;
    }
    if (!best || best.gap < 90) break;
    const atMinute = Math.round(best.from + best.gap / 2);
    let meal = mealAt(new Date(start.getTime() + atMinute * 60000));
    if (meal === 'lunch') meal = 'coffee'; // proper meals only at meal times
    if (meal === 'dinner') meal = 'drink';
    out.push({ atMinute, meal, minutes: BREAKS[meal].minutes });
  }
  return out.sort((a, b) => a.atMinute - b.atMinute);
}

/**
 * Rank places for a break, best first (up to `count`): the right kind of place, open for the
 * whole break when we can tell (closed ones are dropped), independent and notable rather
 * than chains, and close by. Each result carries `open` (true/null) and `closes`.
 */
export function pickFoodPlaces(places, meal, at, { radius = 400, avoid = [], when = null, minutes = null, count = 3 } = {}) {
  const kinds = BREAKS[meal]?.kinds ?? [['cafe']];
  const stay = minutes ?? BREAKS[meal]?.minutes ?? 30;
  const ranked = [];
  const seen = new Set();
  for (const p of places) {
    if (!p.name || avoid.includes(p.name) || seen.has(p.name)) continue;
    const rank = kinds.findIndex((group) => group.includes(p.amenity));
    if (rank < 0) continue;
    const d = distanceMeters(at, p);
    if (d > radius) continue;
    const t = p.tags ?? {};
    const hours = when ? openDuring(t.opening_hours, when, stay) : { open: null, closes: null };
    if (hours.open === false) continue; // closed when you'd get there
    let score = 0;
    if (t.wikipedia || t.wikidata) score += 2; // notable: has its own story
    if (t.brand || t['brand:wikidata']) score -= 2.5; // a chain: something local first, chains only as a last resort
    if (hours.open === true) score += 0.8; // known to be open
    else if (when) score -= 0.6; // hours unknown
    if (t.website) score += 0.4;
    if (t.cuisine) score += 0.3;
    if (t.outdoor_seating === 'yes') score += 0.2;
    score -= rank * 3; // the fitting kind first: a restaurant for lunch, unless there's none
    score -= d / radius; // closer is better
    seen.add(p.name);
    ranked.push({ ...p, open: hours.open, closes: hours.closes, score, distance: Math.round(d) });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, count);
}

/** The single best place for a break, or null. */
export function pickFoodPlace(places, meal, at, options = {}) {
  return pickFoodPlaces(places, meal, at, { ...options, count: 1 })[0] ?? null;
}

// ---------- Building the route ----------

function legMinutes(a, b, pace) {
  return (distanceMeters(a, b) * pace.detour) / ((pace.kmh * 1000) / 60);
}

function stopMinutes(stop, pace) {
  return stop.visitMinutes ?? stop.breakMinutes ?? pace.dwell;
}

/** Arrival/leave times (minutes from the start) along a route, and the total. */
export function timeline(start, stops, modeId = 'walk', loop = true) {
  const pace = PACE[modeId] ?? PACE.walk;
  let t = 0;
  let meters = 0;
  let prev = start;
  const times = stops.map((stop) => {
    t += legMinutes(prev, stop, pace);
    meters += distanceMeters(prev, stop) * pace.detour;
    const arrive = t;
    t += stopMinutes(stop, pace);
    prev = stop;
    return { arrive: Math.round(arrive), leave: Math.round(t) };
  });
  if (loop && stops.length) {
    t += legMinutes(prev, start, pace);
    meters += distanceMeters(prev, start) * pace.detour;
  }
  return { times, minutes: Math.round(t), meters: Math.round(meters) };
}

function pathMinutes(points, pace) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += legMinutes(points[i - 1], points[i], pace);
  return total;
}

/** Untangle the order (2-opt): keeps the start (and the end, for a loop) fixed. */
function untangle(points, pace) {
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < points.length - 2; i++) {
      for (let j = i + 1; j < points.length - 1; j++) {
        const before = legMinutes(points[i - 1], points[i], pace) + legMinutes(points[j], points[j + 1], pace);
        const after = legMinutes(points[i - 1], points[j], pace) + legMinutes(points[i], points[j + 1], pace);
        if (after + 1e-9 < before) {
          points.splice(i, j - i + 1, ...points.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return points;
}

/**
 * The most interesting places that fit in `minutes` (minus time reserved for breaks),
 * taken best first and slotted in where they add the least walking.
 * Returns { stops, minutes, meters, loop } (breaks are added afterwards with addBreaks).
 */
export function suggestRoute({ start, candidates, modeId = 'walk', minutes = 60, loop = true, reservedMinutes = 0, maxStops = 12 }) {
  const pace = PACE[modeId] ?? PACE.walk;
  const visits = museumVisits(modeId, minutes);
  const budget = minutes - reservedMinutes;
  const pool = candidates
    .map((c) => ({ ...c, kind: placeKind(c), score: interestScore(c) }))
    .filter((c) => Number.isFinite(c.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  const points = loop ? [start, start] : [start];
  const chosen = [];
  let used = 0; // minutes so far

  /** Where a place would slot in with the least extra travel, if it may and fits the time left. */
  const insertionCost = (c, visitMinutes = null) => {
    if (chosen.length >= maxStops || chosen.includes(c)) return null;
    // Skip near-duplicates: the Louvre Pyramid right next to the Louvre.
    if (chosen.some((s) => distanceMeters(s, c) < 60 || (distanceMeters(s, c) < 400 && sharesNameToken(s.title, c.title)))) return null;
    const dwell = visitMinutes ?? pace.dwell;
    let best = null;
    const lastSlot = loop ? points.length - 1 : points.length;
    for (let i = 1; i <= lastSlot; i++) {
      const prev = points[i - 1];
      const next = points[i];
      const extra = next ? legMinutes(prev, c, pace) + legMinutes(c, next, pace) - legMinutes(prev, next, pace) : legMinutes(prev, c, pace);
      if (!best || extra < best.extra) best = { i, extra };
    }
    return used + best.extra + dwell > budget ? null : best;
  };

  /** Slot a place in where it adds the least travel, if it fits the time left. */
  const tryAdd = (c, visitMinutes = null) => {
    const best = insertionCost(c, visitMinutes);
    if (!best) return false;
    const dwell = visitMinutes ?? pace.dwell;
    const stop = { ...c, visitMinutes };
    points.splice(best.i, 0, stop);
    chosen.push(c);
    used += best.extra + dwell;
    return true;
  };

  // One at a time, add the place worth the most for the minutes it adds (getting there and
  // time spent), while any fits. Worth grows steeply with fame, so a must-see a little further
  // away still beats a cluster of minor places, but the walk isn't spent crossing town.
  const addBest = (eligible, visitMinutes = null, maxExtra = Infinity) => {
    let best = null;
    for (const c of pool) {
      if (!eligible(c)) continue;
      const cost = insertionCost(c, visitMinutes);
      if (!cost || cost.extra > maxExtra) continue;
      const ratio = Math.max(0.05, c.score - SCORE_FLOOR) ** 3 / (cost.extra + (visitMinutes ?? pace.dwell));
      if (!best || ratio > best.ratio) best = { c, ratio };
    }
    return Boolean(best) && tryAdd(best.c, visitMinutes);
  };
  // 1. On longer outings, museum visits go on the route first: one within reach, so getting
  // there and back doesn't take the time for everything else (Lisbon: the famous museum 2.5 km
  // away left a half day with 3 stops, fewer than an hour's walk).
  for (let museums = 0; museums < visits.count && addBest((c) => c.kind === 'museum', visits.minutes, budget / 3); museums++);
  // 2. Then everything else worth seeing.
  while (addBest(() => true));

  untangle(points, pace);
  const stops = points.slice(1, loop ? -1 : undefined);
  const { minutes: total, meters } = timeline(start, stops, modeId, loop);
  return { stops, minutes: total, meters, loop, pathMinutes: Math.round(pathMinutes(points, pace)) };
}

/**
 * Where along the route each scheduled break falls: after the stop you leave closest to
 * the planned time (one break per stop).
 */
export function placeBreaks(start, stops, schedule, modeId = 'walk', loop = true) {
  const { times } = timeline(start, stops, modeId, loop);
  const taken = new Set();
  return schedule
    .map((b) => {
      let bestIndex = -1;
      times.forEach((t, i) => {
        if (taken.has(i)) return;
        if (bestIndex < 0 || Math.abs(t.leave - b.atMinute) < Math.abs(times[bestIndex].leave - b.atMinute)) bestIndex = i;
      });
      if (bestIndex >= 0) taken.add(bestIndex);
      return { ...b, afterIndex: bestIndex };
    })
    .filter((b) => b.afterIndex >= 0);
}

/** Insert chosen food places (one per placed break) into the stop list. */
export function addBreaks(stops, placed) {
  const out = [...stops];
  // Insert from the end so earlier indexes stay valid.
  for (const b of [...placed].sort((x, y) => y.afterIndex - x.afterIndex)) {
    if (!b.place) continue;
    out.splice(b.afterIndex + 1, 0, {
      ...b.place,
      title: b.place.name,
      kind: 'food',
      meal: b.meal,
      breakMinutes: b.minutes,
      options: b.options ?? [b.place], // alternatives the traveller can switch to
    });
  }
  return out;
}

// ---------- Fetching food places (OpenStreetMap) ----------

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const defaultFetch = (...args) => globalThis.fetch(...args);

function normalizeOsm(e) {
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (lat == null || !e.tags?.name) return null;
  return { name: e.tags.name, lat, lon, amenity: e.tags.amenity, tags: e.tags };
}

/**
 * Cafés, restaurants and bars around a point: OpenStreetMap's Overpass API first, and the
 * place search (Nominatim, via `geocoder.searchNearby`) if that's unavailable.
 */
export async function findFoodNear({ lat, lon }, meal, { radius = 400, geocoder = null, fetchImpl = defaultFetch } = {}) {
  const amenities = amenitiesFor(meal);
  const query = `[out:json][timeout:10];nwr["amenity"~"^(${amenities.join('|')})$"]["name"](around:${Math.round(radius)},${lat.toFixed(5)},${lon.toFixed(5)});out center tags 60;`;
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), 9000);
    const res = await fetchImpl(`${OVERPASS}?data=${encodeURIComponent(query)}`, { signal: controller?.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const places = (data.elements ?? []).map(normalizeOsm).filter(Boolean);
    if (places.length) return places;
  } catch {
    // fall back below
  }
  if (!geocoder?.searchNearby) return [];
  const results = [];
  for (const amenity of amenities) {
    const found = await geocoder.searchNearby(amenity, { lat, lon }, radius).catch(() => []);
    results.push(...found);
  }
  return results;
}
