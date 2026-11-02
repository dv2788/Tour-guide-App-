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
// (A panorama is a painting all around you in its own rotunda: you go in, like a museum.)
const MUSEUM_RE = /(?:^|[^\p{L}])(?:museum|musée|musee|museo|museu|gallery|galerie|galleria|pinacoteca|kunsthalle|(?:panorama|cyclorama)(?![\p{L}]))/iu;

// ---------- What a place is about: history, culture, landscapes, food ----------
// Whole words (and their plurals), in the five supported languages.
const words = (list) => new RegExp(`(?:^|[^\\p{L}])(?:${list.join('|')})(?![\\p{L}])`, 'iu');
const LANDSCAPE_RE = words([
  // English
  'parks?', 'gardens?', 'viewpoints?', 'lookout', 'overlook', 'belvedere', 'promenade', 'esplanade', 'hills?', 'mountains?', 'mount', 'peaks?',
  'summit', 'volcano', 'lakes?', 'lagoon', 'beach(?:es)?', 'bay', 'cove', 'waterfalls?', 'falls', 'cascades?', 'gorge', 'canyon', 'cliffs?', 'cape',
  'headland', 'islands?', 'islet', 'forests?', 'woods', 'woodland', 'nature reserve', 'national park', 'caves?', 'dunes?', 'valley', 'oasis',
  'springs', 'coast', 'coastline', 'seafront', 'waterfront', 'arboretum',
  // French
  'parc', 'jardins?', 'belvédère', 'colline', 'montagne', 'mont', 'sommet', 'volcan', 'lac', 'lagune', 'plages?', 'baie', 'crique', 'chutes?',
  'gorges', 'falaises?', 'cap', 'île', 'forêt', 'bois', 'réserve naturelle', 'grottes?', 'vallée', 'côte', 'corniche',
  // Spanish
  'parque', 'jardín', 'jardines', 'mirador', 'cerro', 'colina', 'montaña', 'monte', 'cumbre', 'volcán', 'lago', 'laguna', 'playas?', 'bahía',
  'cala', 'cascada', 'garganta', 'cañón', 'acantilados?', 'cabo', 'isla', 'bosque', 'reserva natural', 'cuevas?', 'valle', 'manantial', 'malecón',
  // German
  'garten', 'gärten', 'aussichtspunkt', 'berg', 'hügel', 'gipfel', 'vulkan', 'see', 'strand', 'bucht', 'wasserfall', 'schlucht', 'klippen?',
  'kap', 'insel', 'wald', 'naturschutzgebiet', 'nationalpark', 'höhle', 'tal', 'küste',
  // Italian
  'parco', 'giardin[oi]', 'collina', 'montagna', 'vetta', 'vulcano', 'spiaggia', 'baia', 'cascata', 'gola', 'scogliera', 'capo', 'isola',
  'foresta', 'riserva naturale', 'grotta', 'lungomare',
]);
// Parks and the like that aren't landscapes.
const NOT_LANDSCAPE_RE =
  /(?:car|business|industrial|science|technology|office|retail|theme|amusement|water|trailer|skate|holiday|caravan)\s+park|parking|parkhaus|parkplatz|stadium|arena|estadio|stade|stadion|hotel|shopping|station|airport|cemetery|cimetière|cementerio|friedhof|cimitero/iu;
const CULTURE_RE = words([
  'theat(?:re|er)s?', 'opera(?: house)?', 'concert hall', 'auditorium', 'philharmonic', 'library', 'cultural cent(?:re|er)', 'arts? cent(?:re|er)',
  'cinema', 'conservatory', 'théâtre', 'opéra', 'bibliothèque', 'centre culturel', 'salle de concert', 'teatro', 'ópera', 'biblioteca',
  'centro cultural', 'auditorio', 'theater', 'oper', 'bibliothek', 'kulturzentrum', 'konzerthaus', 'philharmonie', 'centro culturale',
]);
const FOOD_RE = words([
  'market(?:s| hall)?', 'food hall', 'covered market', 'caf[eé]s?', 'coffee ?house', 'restaurants?', 'bakery', 'patisserie', 'brewery', 'winery',
  'vineyards?', 'chocolate', 'tea ?house', 'marché', 'halles', 'brasserie', 'boulangerie', 'pâtisserie', 'chocolaterie', 'vignoble', 'mercado',
  'confitería', 'pastelería', 'panadería', 'cervecería', 'bodega', 'chocolatería', 'viñedo', 'markt', 'markthalle', 'kaffeehaus', 'konditorei',
  'bäckerei', 'brauerei', 'weingut', 'mercato', 'caffè', 'pasticceria', 'birrificio', 'enoteca', 'gelateria', 'osteria', 'trattoria',
]);

/** What you'd do the outing for, in the order offered: 'history' | 'culture' | 'landscape' | 'food'. */
export const INTERESTS = ['history', 'culture', 'landscape', 'food'];

/** The interests a place answers (a set: a castle on a hill is history and landscape). */
export function placeThemes(poi) {
  const text = `${poi.title ?? ''} ${poi.description ?? ''}`;
  const themes = new Set();
  if (HISTORIC_RE.test(text)) themes.add('history');
  if (MUSEUM_RE.test(text) || CULTURE_RE.test(text)) themes.add('culture');
  if (LANDSCAPE_RE.test(text) && !NOT_LANDSCAPE_RE.test(text)) themes.add('landscape');
  if (FOOD_RE.test(text)) themes.add('food');
  return themes;
}
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
  /^(?:[\p{L}'’-]+\s+){0,3}(?:think tank|academy|national church|denomination|(?:arch)?diocese|(?:archi)?diocèse|(?:arqui|archi)?diócesis|(?:arci)?diocesi|(?:erz)?bistum|(?:erz)?diözese|network|réseau|red de|netzwerk|rete di|parlement|parlamento|parlament|lower house|upper house|chambre basse|chambre haute|cámara baja|cámara alta|camera bassa|camera alta|unterhaus|oberhaus|juridiction|tribunal|famine|epidemic|pandemic|hambruna|hungersnot|carestia|épidémie|epidemia|entity|entité|entidad|ente|producer|producteur|productor|produttore|distributeur|operator|opérateur|operador|hersteller|konzern|hypothèse|strategic plan|military plan|diplomatic (?:mission|service)|mission diplomatique|misión diplomática|diplomatische vertretung|missione diplomatica|institution of the european union)(?![\p{L}])/iu;
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
// What a place *is*, when that's a memorial, a monument or a museum: then words further on are
// what it remembers, not what it is ("War memorial for the Battle of Waterloo", "Memorial of the
// Battle of Waterloo", "musée de la bataille de Waterloo").
const MEMORIAL_START_RE =
  /^(?:[\p{L}'’-]+\s+){0,2}(?:memorial|monument|statue|mound|cenotaph|obelisk|mausoleum|museum|mémorial|musée|butte|monumento|estatua|museo|denkmal|mahnmal|gedenkstätte|statua|sacrario)(?![\p{L}])/iu;
// A painting you walk into: "Painting by Louis Dumoulin in a rotunda" (the Waterloo Panorama).
const ROTUNDA_RE = /(?:^|[^\p{L}])(?:rotunda|rotonde|rotonda|panorama|cyclorama)(?![\p{L}])/iu;
// Coordinate kinds (from Wikipedia's {{coord}}) that are never a stop on a walk.
const NOT_A_STOP_TYPES = new Set(['country', 'state', 'adm1st', 'adm2nd', 'adm3rd', 'city', 'event', 'edu', 'airport', 'waterbody', 'river', 'mountain', 'satellite', 'glacier', 'pass', 'forest']);
// …except, on an outing for landscapes, these.
const NATURE_TYPES = new Set(['waterbody', 'mountain', 'glacier', 'pass', 'forest']);

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
export function isPlaceToSee(poi, { nature = false } = {}) {
  if (poi.category === 'skip' || poi.disambiguation || poi.gone) return false;
  const description = poi.description ?? '';
  const title = poi.title ?? '';
  // On an outing for landscapes, a lake, a bay, a hill or a forest is a place to go.
  const natural = nature && placeThemes(poi).has('landscape');
  const memorial = MEMORIAL_START_RE.test(description);
  if ((!natural && AREA_RE.test(description) && !TOWN_BUILDING_RE.test(description)) || NOT_A_PLACE_START_RE.test(description)) return false;
  if (!memorial && (NOT_A_PLACE_RE.test(description) || NOT_A_PLACE_INTL_RE.test(description))) return false;
  // An assembly, unless it's its building ("edificio legislativo": Argentina's Palace of Congress).
  if (LEGISLATURE_RE.test(description) && !STRUCTURE_RE.test(description) && !HISTORIC_RE.test(title)) return false;
  if ((IN_A_COLLECTION_RE.test(description) && !ROTUNDA_RE.test(`${title} ${description}`)) || GONE_RE.test(description) || NOT_A_PLACE_DE_RE.test(description)) return false;
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
  if (GONE_TITLE_RE.test(title) || (NOT_A_STOP_TYPES.has(poi.coordType) && !(natural && NATURE_TYPES.has(poi.coordType)))) return false;
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
export function interestScore(poi, { interests = null } = {}) {
  const nature = !!interests?.includes('landscape');
  if (!isPlaceToSee(poi, { nature })) return -Infinity;
  const themes = placeThemes(poi);
  // A stub has too little to tell; a viewpoint or a garden needs fewer words to be worth it.
  if ((poi.length ?? 3000) < (nature && themes.has('landscape') ? 1200 : 2500)) return -Infinity;
  const story = Math.log10(Math.max(1000, poi.length ?? 3000)); // ~3.4 (short) to ~5.3 (major landmark)
  // Without the language count (older data), the article length stands in for fame.
  let score = poi.langs != null ? 1.8 * Math.log10(1 + poi.langs) + 0.4 * story : story;
  const kind = placeKind(poi);
  if (kind === 'historic') score += 0.5;
  if (kind === 'museum') score += 0.6;
  if (poi.thumbnail) score += 0.2;
  if (poi.category === 'minor') score -= 1.5;
  // What you came for first: a place that answers one of your interests rises, one that answers
  // none sinks (a world-famous landmark on the way can still make it).
  if (interests?.length) {
    const hits = interests.filter((i) => themes.has(i)).length;
    score += hits ? 0.9 + 0.3 * (hits - 1) : -2.5;
  }
  return score;
}

// Below this score a place adds next to nothing to a walk (see interestScore's range).
const SCORE_FLOOR = 3.3;

/** Travel pace for planning: speed, time spent at an ordinary stop, and how much longer streets are than a straight line. */
export const PACE = {
  walk: { kmh: 4.5, dwell: 5, detour: 1.3 },
  hike: { kmh: 3.5, dwell: 8, detour: 1.5 }, // paths wind and climb; time to take in the view
  run: { kmh: 9, dwell: 1, detour: 1.3 },
  cycle: { kmh: 14, dwell: 3, detour: 1.3 },
  drive: { kmh: 22, dwell: 3, detour: 1.4 },
};

export const DURATIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1 h 30' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: 'Half day' },
  { minutes: 360, label: '6 hours' },
  { minutes: 480, label: 'Full day' },
  { minutes: 600, label: 'Long day' },
];

/** How far to look for places: you can only go so far and come back in the time. */
export function searchRadiusFor(modeId, minutes) {
  const pace = PACE[modeId] ?? PACE.walk;
  const reach = (pace.kmh * 1000 * (minutes / 60)) / 3;
  // A day's drive reaches the next valley; a walk or a hike stays within 10 km.
  const cap = { drive: 60000, cycle: 25000 }[modeId] ?? 10000;
  return Math.round(Math.min(cap, Math.max(600, reach)));
}

/** Museums worth going inside, depending on how long you're out (never while running). */
export function museumVisits(modeId, minutes, interests = null) {
  if (modeId === 'run' || modeId === 'hike') return { count: 0, minutes: 0 };
  // Going inside a museum is for a culture outing (or one that asked for nothing in particular).
  if (interests?.length && !interests.includes('culture')) return { count: 0, minutes: 0 };
  if (minutes >= 420) return { count: 2, minutes: 75 };
  if (minutes >= 210) return { count: 1, minutes: 60 };
  if (minutes >= 110) return { count: 1, minutes: 45 };
  return { count: 0, minutes: 0 };
}

// ---------- How long to stay at each place ----------
// Not the same everywhere: a look at a statue, a while at a church, longer at a cathedral, a
// castle or a viewpoint, and an hour or more inside a great museum. `base` is what a place gets
// when time is short; when the outing has time to spare, the best places get more, up to `max`.

// What a place is: its description's first words ("Statue of…", "Cathedral in…"), or its title.
const headWords = (list) => new RegExp(`^(?:[\\p{L}'’-]+\\s+){0,2}(?:${list.join('|')})(?![\\p{L}])`, 'iu');
const SMALL_WORDS = [
  'statues?', 'busts?', 'sculptures?', 'fountains?', 'plaques?', 'obelisks?', 'columns?', 'crosses', 'cross', 'steles?', 'stones?', 'sundial',
  'murals?', 'wells?', 'trees?', 'elm', 'oak', 'buste', 'fontaines?', 'obélisque', 'colonne', 'croix', 'stèle', 'borne', 'estatua', 'busto',
  'escultura', 'fuente', 'placa', 'obelisco', 'columna', 'cruz', 'büste', 'skulptur', 'brunnen', 'gedenktafel', 'obelisk', 'säule', 'kreuz',
  'statua', 'scultura', 'fontana', 'targa', 'colonna', 'croce',
];
const BIG_WORDS = [
  'cathedral', 'basilica', 'minster', 'abbey', 'priory', 'monastery', 'castle', 'palace', 'fortress', 'fort', 'citadel', 'ruins', 'archaeological site',
  'amphitheat(?:re|er)', 'battlefield', 'mound', 'world heritage site', 'cathédrale', 'basilique', 'abbaye', 'prieuré', 'monastère', 'château',
  'palais', 'forteresse', 'citadelle', 'ruines', 'site archéologique', 'amphithéâtre', 'butte', 'champ de bataille', 'catedral', 'basílica',
  'abadía', 'monasterio', 'castillo', 'palacio', 'alcázar', 'fortaleza', 'ciudadela', 'ruinas', 'yacimiento arqueológico', 'anfiteatro', 'dom',
  'kathedrale', 'münster', 'basilika', 'abtei', 'kloster', 'schloss', 'burg', 'festung', 'zitadelle', 'ruine', 'palast', 'cattedrale', 'duomo',
  'abbazia', 'monastero', 'castello', 'palazzo reale', 'reggia', 'fortezza', 'cittadella', 'rovine', 'sito archeologico',
];
const OPEN_WORDS = [
  'squares?', 'plaza', 'piazza', 'platz', 'praça', 'markets?', 'marketplace', 'market hall', 'marché', 'halles', 'mercado', 'markt', 'markthalle', 'mercato',
];
const SMALL_HEAD_RE = headWords(SMALL_WORDS);
const BIG_HEAD_RE = headWords(BIG_WORDS);
const OPEN_HEAD_RE = headWords(OPEN_WORDS);
const BIG_RE = words(BIG_WORDS);

/** 'small' (a statue, a fountain) | 'building' (a church, a monument) | 'big' (a cathedral, a castle) | 'open' (a square, a park, a viewpoint). */
export function placeSize(poi) {
  const title = poi.title ?? '';
  const description = poi.description ?? '';
  const what = description || title;
  if (OPEN_HEAD_RE.test(what) || (placeThemes(poi).has('landscape') && !BIG_HEAD_RE.test(what))) return 'open';
  if (BIG_HEAD_RE.test(what) || BIG_RE.test(title)) return 'big';
  if (SMALL_HEAD_RE.test(what)) return 'small';
  return 'building';
}

// Minutes on foot: { base, max }.
const STAY = {
  small: { base: 5, max: 10 }, // a look and the story
  building: { base: 7, max: 25 }, // step inside, walk around it
  big: { base: 12, max: 45 }, // a cathedral, a castle, ruins, a battlefield to climb and look over
  open: { base: 9, max: 40 }, // a square, a market, a park, a garden, a viewpoint
};
// By bike (lock it and go), by car (parking included; small things are seen as you drive past),
// and on a hike (the view is what you came for).
const STAY_BY_MODE = {
  cycle: { small: { base: 3, max: 8 } },
  drive: { small: { base: 2, max: 5 }, building: { base: 10, max: 30 }, big: { base: 20, max: 60 }, open: { base: 15, max: 45 } },
  hike: { open: { base: 15, max: 60 } },
};

// Famous places deserve more of your time: ~0.8 (known locally) to ~1.4 (world-famous).
const fame = (poi) => (poi.langs == null ? 1 : 0.6 + 0.4 * Math.log10(1 + poi.langs));

/**
 * How long to stay at a place on this outing: { base, max } minutes. On a short outing every
 * place gets a quick look (half an hour can't hold a castle visit); from half a day, each its due.
 */
export function stayFor(poi, modeId = 'walk', minutes = 120) {
  const pace = PACE[modeId] ?? PACE.walk;
  if (modeId === 'run') return { base: pace.dwell, max: pace.dwell }; // a runner doesn't linger
  const size = placeSize(poi);
  const stay = STAY_BY_MODE[modeId]?.[size] ?? STAY[size];
  const quick = STAY_BY_MODE[modeId]?.small ?? STAY.small;
  // 30 min: a quick look everywhere; half a day and more: each place its full time. In between,
  // a little of both, so a morning in a dense old town still has its many places.
  const room = Math.min(1, Math.max(0, (minutes - 30) / 210));
  const f = fame(poi);
  // Round numbers from 10 minutes: "about 15 minutes", not 17.
  const round = (m) => (m >= 10 ? Math.round(m / 5) * 5 : Math.round(m));
  const base = Math.max(1, round(quick.base + Math.max(0, stay.base * f - quick.base) * room));
  return { base, max: Math.max(base, round(stay.max * f)) };
}

/** Time inside a museum: the outing's museum time, more for a great museum, less for a small one. */
export function visitFor(poi, minutes) {
  const small = (poi.length ?? 10000) < 5000 && (poi.langs ?? 10) < 5;
  const f = Math.min(1.15, Math.max(0.85, fame(poi))); // the rest comes from spare time, up to max
  const base = Math.min(small ? 45 : 120, Math.max(30, Math.round((minutes * f) / 5) * 5));
  return { base, max: Math.min(180, Math.round((base * 1.75) / 5) * 5) };
}

/**
 * Hand spare time to the stops, the best places first, each up to its max: with a few places
 * and a whole afternoon, you stay longer at the castle rather than come back early. Changes
 * `stayMinutes` / `visitMinutes` on the stops; returns the minutes it couldn't place.
 */
export function spreadSpareTime(stops, spare) {
  const time = (s) => (s.visitMinutes != null ? 'visitMinutes' : 'stayMinutes');
  const room = (s) => Math.max(0, (s.visitMinutes != null ? s.visitMax : s.stayMax) - s[time(s)]);
  // Worth: how much better than filler the place is (the best get most), times what's left to see.
  const worth = (s) => Math.max(0.3, (s.score ?? SCORE_FLOOR) - SCORE_FLOOR + 0.5) ** 2;
  const before = new Map(stops.map((st) => [st, st[time(st)]]));
  let left = Math.max(0, spare);
  for (let round = 0; round < 6 && left >= 1; round++) {
    const open = stops.filter((s) => room(s) >= 1);
    const total = open.reduce((n, s) => n + worth(s), 0);
    if (!total) break;
    let given = 0;
    for (const s of open) {
      const add = Math.min(room(s), (left * worth(s)) / total);
      s[time(s)] += add;
      given += add;
    }
    left -= given;
  }
  // Round to what you'd tell a friend: "about 20 minutes", never "17". Down, so it still fits.
  for (const s of stops) {
    const key = time(s);
    if (s[key] == null) continue;
    const v = s[key] + 1e-9;
    const fives = Math.floor(v / 5) * 5;
    s[key] = v >= 10 && fives >= before.get(s) ? fives : Math.floor(v);
  }
  return left;
}

// ---------- Food and drink breaks ----------

// `kinds`: OpenStreetMap amenities, best fit first (a restaurant for lunch, a café if there's none).
export const BREAKS = {
  coffee: { minutes: 20, kinds: [['cafe']] },
  lunch: { minutes: 60, kinds: [['restaurant'], ['cafe']] },
  drink: { minutes: 30, kinds: [['bar', 'pub'], ['cafe']] },
  dinner: { minutes: 75, kinds: [['restaurant']] },
  // On a food outing, between meals: a market, a bakery, a pastry shop, an ice cream.
  taste: { minutes: 20, kinds: [['marketplace', 'bakery', 'pastry', 'confectionery', 'chocolate', 'ice_cream', 'cheese', 'deli'], ['cafe']] },
};
// Of these, the ones OpenStreetMap files as shops rather than amenities.
const SHOP_KINDS = new Set(['bakery', 'pastry', 'confectionery', 'chocolate', 'cheese', 'deli']);
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
export function breakSchedule(start, minutes, { food = false } = {}) {
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
  // A food outing tastes something about every hour; otherwise a break every 2½ hours.
  const extra = Math.max(0, Math.round(minutes / (food ? 60 : 150)) - out.length);
  for (let k = 0; k < extra; k++) {
    let best = null;
    let prevEnd = 0;
    for (const b of [...out].sort((a, c) => a.atMinute - c.atMinute).concat({ atMinute: minutes, minutes: 0 })) {
      const gap = b.atMinute - prevEnd;
      if (!best || gap > best.gap) best = { gap, from: prevEnd };
      prevEnd = b.atMinute + b.minutes;
    }
    if (!best || best.gap < (food ? 50 : 90)) break;
    const atMinute = Math.round(best.from + best.gap / 2);
    let meal = mealAt(new Date(start.getTime() + atMinute * 60000));
    if (meal === 'lunch') meal = 'coffee'; // proper meals only at meal times
    if (meal === 'dinner') meal = 'drink';
    if (food && meal === 'coffee') meal = 'taste';
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
  return stop.visitMinutes ?? stop.breakMinutes ?? stop.stayMinutes ?? pace.dwell;
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
export function suggestRoute({ start, candidates, modeId = 'walk', minutes = 60, loop = true, reservedMinutes = 0, maxStops = 12, interests = null, avoid = null }) {
  const pace = PACE[modeId] ?? PACE.walk;
  const visits = museumVisits(modeId, minutes, interests);
  const budget = minutes - reservedMinutes;
  const pool = candidates
    .filter((c) => !avoid?.has(c.id) && !avoid?.has(c.title))
    .map((c) => ({ ...c, kind: placeKind(c), themes: placeThemes(c), score: interestScore(c, { interests }), stay: stayFor(c, modeId, minutes), visit: visitFor(c, visits.minutes) }))
    // With interests chosen, only what answers them (or is famous enough to anyway): no filler.
    .filter((c) => Number.isFinite(c.score) && (!interests?.length || c.score >= SCORE_FLOOR))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  const points = loop ? [start, start] : [start];
  const chosen = [];
  let used = 0; // minutes so far

  // Time there: inside, for a museum visit; otherwise what the place deserves (a statue, a castle).
  const dwellAt = (c, visit) => (visit ? c.visit.base : c.stay.base);

  /** Where a place would slot in with the least extra travel, if it may and fits the time left. */
  const insertionCost = (c, visit = false) => {
    if (chosen.length >= maxStops || chosen.includes(c)) return null;
    // Skip near-duplicates: the Louvre Pyramid right next to the Louvre.
    if (chosen.some((s) => distanceMeters(s, c) < 60 || (distanceMeters(s, c) < 400 && sharesNameToken(s.title, c.title)))) return null;
    const dwell = dwellAt(c, visit);
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
  const tryAdd = (c, visit = false) => {
    const best = insertionCost(c, visit);
    if (!best) return false;
    const dwell = dwellAt(c, visit);
    const stop = visit
      ? { ...c, visitMinutes: c.visit.base, visitMax: c.visit.max, stayMinutes: null }
      : { ...c, visitMinutes: null, stayMinutes: c.stay.base, stayMax: c.stay.max };
    points.splice(best.i, 0, stop);
    chosen.push(c);
    used += best.extra + dwell;
    return true;
  };

  // One at a time, add the place worth the most for the minutes it adds (getting there and
  // time spent), while any fits. Worth grows steeply with fame, so a must-see a little further
  // away still beats a cluster of minor places, but the walk isn't spent crossing town.
  // (Time there counts too, but a place that deserves a long stay also gives more back for it.)
  const addBest = (eligible, { visit = false, maxExtra = Infinity } = {}) => {
    let best = null;
    for (const c of pool) {
      if (!eligible(c)) continue;
      const cost = insertionCost(c, visit);
      if (!cost || cost.extra > maxExtra) continue;
      const dwell = dwellAt(c, visit);
      const ratio = Math.max(0.05, c.score - SCORE_FLOOR) ** 3 / (cost.extra + pace.dwell + (dwell - pace.dwell) / 2);
      if (!best || ratio > best.ratio) best = { c, ratio };
    }
    return Boolean(best) && tryAdd(best.c, visit);
  };
  // 1. On longer outings, museum visits go on the route first: one within reach, so getting
  // there and back doesn't take the time for everything else (Lisbon: the famous museum 2.5 km
  // away left a half day with 3 stops, fewer than an hour's walk).
  for (let museums = 0; museums < visits.count && addBest((c) => c.kind === 'museum', { visit: true, maxExtra: budget / 3 }); museums++);
  // 2. Several interests: take turns, the one with the fewest stops so far first, so "history and
  // landscapes" has both (not only the monuments, because they happen to be closer together).
  if (interests?.length > 1) {
    const count = Object.fromEntries(interests.map((i) => [i, 0]));
    for (const c of chosen) for (const i of interests) if (c.themes.has(i)) count[i]++;
    for (let turn = true; turn; ) {
      turn = false;
      for (const i of [...interests].sort((a, b) => count[a] - count[b])) {
        if (!addBest((c) => c.themes.has(i))) continue;
        for (const j of interests) if (chosen.at(-1).themes.has(j)) count[j]++;
        turn = true;
        break;
      }
    }
  }
  // 3. Then everything else worth seeing.
  while (addBest(() => true));
  // 4. A museum that's on the route anyway (too far to aim for at first) becomes the visit, if
  // one is still due and the time allows: you're at the Waterloo Panorama, so go in.
  let visitsLeft = visits.count - points.filter((p) => p.visitMinutes != null).length;
  for (const stop of points.filter((p) => p.kind === 'museum' && p.visitMinutes == null).sort((a, b) => b.score - a.score)) {
    const more = stop.visit.base - stop.stayMinutes;
    if (visitsLeft <= 0 || used + more > budget) continue;
    Object.assign(stop, { visitMinutes: stop.visit.base, visitMax: stop.visit.max, stayMinutes: null });
    used += more;
    visitsLeft--;
  }

  untangle(points, pace);
  const stops = points.slice(1, loop ? -1 : undefined);
  // Time left over (few places around, or the most a day can hold): longer at the best ones.
  spreadSpareTime(stops, budget - timeline(start, stops, modeId, loop).minutes - 1); // (a minute for rounding)
  const { minutes: total, meters } = timeline(start, stops, modeId, loop);
  return { stops, minutes: total, meters, loop, pathMinutes: Math.round(pathMinutes(points, pace)) };
}

// ---------- Several itineraries to choose from ----------

/** What each kind of outing is called. */
export const INTEREST_TITLES = {
  history: 'History and monuments',
  culture: 'Museums and culture',
  landscape: 'Parks, views and nature',
  food: 'Markets and local flavours',
};
const ALTERNATIVE_TITLES = {
  history: 'More history, other places',
  culture: 'More culture, other places',
  landscape: 'More nature, other views',
  food: 'More flavours, other places',
};
const SHORT_NAMES = { history: 'history', culture: 'culture', landscape: 'landscapes', food: 'food' };
// What goes well with each interest, for a third proposal when only one was chosen.
const COMPANION = { history: 'culture', culture: 'history', landscape: 'history', food: 'history' };

/** "History, culture and landscapes". */
export function proposalTitle(interests) {
  if (interests.length === 1) return INTEREST_TITLES[interests[0]];
  const names = interests.map((i) => SHORT_NAMES[i]);
  const text = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return text[0].toUpperCase() + text.slice(1);
}

/** How much two routes share: places in common, out of the longer one's. (A one-stop route
 * inside a five-stop one is a different outing; four of five the same is not.) */
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / Math.max(a.size, b.size);
}

/**
 * Up to three different itineraries for what the traveller wants to see. No interest chosen:
 * one route through the best-known places (as before). Several: all of them together first,
 * then each on its own. Just one: the best route for it, another through different places, and
 * one with a companion interest (landscapes and history: a castle on the hill). A proposal
 * that is mostly the same places as one before it is dropped, and so is an empty one.
 * Each: { key, title, interests, alternative, schedule, route } (breaks are added once chosen).
 */
export function proposeOutings({ start, candidates, modeId = 'walk', minutes = 60, loop = true, startedAt = new Date(), interests = [], maxStops = 12 }) {
  const picked = INTERESTS.filter((i) => interests?.includes(i));
  const out = [];
  const add = (key, title, ints, { avoid = null } = {}) => {
    const schedule = breakSchedule(startedAt, minutes, { food: !!ints?.includes('food') });
    const reservedMinutes = schedule.reduce((n, b) => n + b.minutes, 0);
    const route = suggestRoute({ start, candidates, modeId, minutes, loop, reservedMinutes, maxStops, interests: ints, avoid });
    if (!route.stops.length) return;
    // Named after an interest, it must mostly be about it: "More flavours" can't be the
    // Sagrada Família alone, however famous (a famous landmark on the way is fine).
    if (ints?.length) {
      const matching = route.stops.filter((stop) => ints.some((i) => stop.themes?.has(i) ?? placeThemes(stop).has(i))).length;
      if (!matching || matching * 2 < route.stops.length) return;
    }
    // By name too: the same park can come back from two searches under two page ids.
    const ids = new Set(route.stops.flatMap((s) => [s.id, s.title]));
    if (out.some((o) => overlap(ids, o.ids) >= 0.7)) return;
    out.push({ key, title, interests: ints ?? [], alternative: !!avoid, ids, schedule, route });
  };
  if (!picked.length) {
    add('best', 'The best-known places', null);
  } else if (picked.length === 1) {
    const [only] = picked;
    add(only, INTEREST_TITLES[only], picked);
    if (out[0]) add(`${only}-more`, ALTERNATIVE_TITLES[only], picked, { avoid: out[0].ids });
    const pair = INTERESTS.filter((i) => i === only || i === COMPANION[only]);
    add(pair.join('+'), proposalTitle(pair), pair);
  } else {
    add(picked.join('+'), proposalTitle(picked), picked);
    for (const i of picked) if (out.length < 3) add(i, INTEREST_TITLES[i], [i]);
  }
  return out.slice(0, 3).map(({ ids, ...rest }) => rest);
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
  // A bakery or pastry shop is filed as a shop: treated like any other kind of place to eat.
  return { name: e.tags.name, lat, lon, amenity: e.tags.amenity ?? e.tags.shop, tags: e.tags };
}

/** The Overpass query for places of these kinds (amenities, and shops for the food ones). */
export function foodQuery(kinds, { lat, lon }, radius) {
  const amenities = kinds.filter((k) => !SHOP_KINDS.has(k));
  const shops = kinds.filter((k) => SHOP_KINDS.has(k));
  const around = `(around:${Math.round(radius)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const parts = [
    amenities.length ? `nwr["amenity"~"^(${amenities.join('|')})$"]["name"]${around};` : '',
    shops.length ? `nwr["shop"~"^(${shops.join('|')})$"]["name"]${around};` : '',
  ].join('');
  return `[out:json][timeout:10];(${parts});out center tags 60;`;
}

/**
 * Cafés, restaurants and bars around a point: OpenStreetMap's Overpass API first, and the
 * place search (Nominatim, via `geocoder.searchNearby`) if that's unavailable.
 */
export async function findFoodNear({ lat, lon }, meal, { radius = 400, geocoder = null, fetchImpl = defaultFetch } = {}) {
  const amenities = amenitiesFor(meal);
  const query = foodQuery(amenities, { lat, lon }, radius);
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
