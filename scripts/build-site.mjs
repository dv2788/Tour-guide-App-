// Builds the pages search engines read: one landing page per sample tour
// (tours/<id>/index.html), the sitemap, and the tour links in the home page footer.
// Stop descriptions come from Wikipedia (cached in tours/wiki-cache.json, so it runs offline).
// Usage: node scripts/build-site.mjs        (SITE_URL=https://your.domain/ to change the address)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SAMPLES } from '../js/samples.js';
import { EVENTS, cityKeys, eventLink } from '../js/events.js';

const ROOT = new URL('../', import.meta.url);
const SITE = (process.env.SITE_URL ?? 'https://dv2788.github.io/Tour-guide-App-/').replace(/\/?$/, '/');
const TODAY = new Date().toISOString().slice(0, 10);
const UA = 'Roamie-site-builder/1.0 (https://github.com/dv2788/Tour-guide-App-)';

// The Wikipedia article for each stop, when its title differs from the name the guide says.
const ARTICLES = {
  'Plaça Reial': 'Royal Square (Barcelona)',
  'Santa Maria del Mar': 'Santa Maria del Mar, Barcelona',
  'Galeries Royales Saint-Hubert': 'Royal Saint-Hubert Galleries',
  'Cathedral of St. Michael and St. Gudula': 'St. Michael and St. Gudula Cathedral',
  'Palais Royal de Bruxelles': 'Royal Palace of Brussels',
  'Bo-Kaap Museum': 'Bo-Kaap',
  "St. George's Cathedral": "St. George's Cathedral, Cape Town",
  'Palais du Peuple': 'Palais du Peuple (Kinshasa)',
  'Cathédrale Notre-Dame du Congo': 'Our Lady of the Congo Cathedral',
  'Jardin botanique de Kinshasa': 'Kinshasa Botanical Garden',
  'Palais de la Nation': 'Palais de la Nation (Kinshasa)',
  'Art Deco Welcome Center': 'Miami Beach Architectural District',
  'The Wolfsonian–FIU': 'Wolfsonian–FIU',
  'Española Way': null,
  'Louvre Museum': 'Louvre',
  'Ferry Building': 'San Francisco Ferry Building',
  'Dragon Gate': 'Dragon Gate (San Francisco)',
  'Washington Square': 'Washington Square (San Francisco)',
  'Shenzhen Civic Center': 'Civic Center (Shenzhen)',
  'Ping An Finance Center': 'Ping An Finance Centre',
  // South America
  'Catedral Metropolitana de Buenos Aires': 'Buenos Aires Metropolitan Cathedral',
  'Cabildo de Buenos Aires': 'Cabildo of Buenos Aires',
  'cusco:Plaza de Armas': 'Plaza de Armas (Cusco)',
  'Catedral del Cusco': 'Cusco Cathedral',
  'Iglesia de la Compañía': 'Iglesia de la Compañía de Jesús, Cusco',
  'Twelve-angled Stone': 'Twelve-angled stone',
  'Plaza San Martín': 'Plaza San Martín, Lima',
  'Plaza de Armas de Lima': 'Plaza Mayor, Lima',
  'Palacio de Gobierno': 'Government Palace, Peru',
  'Catedral de Lima': 'Metropolitan Cathedral of Lima',
  'Palacio Arzobispal': "Archbishop's Palace, Lima",
  'Convento de San Francisco': 'Basilica and Convent of San Francisco, Lima',
  'Iglesia de San Pedro Claver': 'Iglesia de San Pedro Claver, Cartagena',
  'Palacio de la Inquisición': 'Palace of the Inquisition (Cartagena, Colombia)',
  'Catedral de Cartagena': 'Cartagena Cathedral, Colombia',
  'Igreja da Candelária': 'Candelária Church',
  'Theatro Municipal': 'Theatro Municipal (Rio de Janeiro)',
  'Arcos da Lapa': 'Carioca Aqueduct',
  'Palacio de La Moneda': 'La Moneda Palace',
  'Plaza de la Constitución': 'Plaza de la Constitución (Santiago)',
  'Museo de Arte Precolombino': 'Museo Chileno de Arte Precolombino',
  'santiago:Plaza de Armas': 'Plaza de Armas (Santiago)',
  'Catedral Metropolitana de Santiago de Chile': 'Santiago Metropolitan Cathedral',
  'Mercado Central': 'Mercado Central de Santiago',
  'Cerro Santa Lucía': 'Santa Lucía Hill',
  // Africa
  'Jemaa el-Fna': 'Jemaa el-Fnaa',
  'Koutoubia Mosque': 'Kutubiyya Mosque',
  'Bab Zuweila': 'Bab Zuwayla',
  'Qalawun Complex': 'Qalawun complex',
  'Zitouna Mosque': 'Al-Zaytuna Mosque',
  'Kasbah Mosque': 'Kasbah Mosque, Tunis',
  'Al-Qarawiyyin Mosque': 'University of al-Qarawiyyin',
  'Christ Church': 'Christ Church Cathedral, Zanzibar',
  'Old Dispensary': 'Old Dispensary (Zanzibar)',
  'Palace Museum': "Sultan's Palace, Zanzibar",
  'Old Fort': 'Old Fort of Zanzibar',
  'Forodhani Park': 'Forodhani Gardens',
  "Place de l'Indépendance": null,
  'Musée Théodore Monod': 'Théodore Monod African Art Museum',
  'Cathédrale du Souvenir Africain': 'Our Lady of Victories Cathedral, Dakar',
  'Musée des Civilisations Noires': 'Museum of Black Civilisations',
  'Grande Mosquée de Dakar': 'Grand Mosque of Dakar',
  // Off the beaten track (second batch)
  'Palombaro Lungo': null,
  'Cattedrale di Matera': 'Matera Cathedral',
  'Madonna de Idris': null,
  'Casa Grotta di Vico Solitario': null,
  'Palazzo Lanfranchi': 'Museo nazionale d\'arte medievale e moderna della Basilicata',
  'Convento di Sant\'Agostino': null,
  'Gjirokastër Castle': 'Gjirokastër Fortress',
  'Gjirokastër Bazaar': 'Bazaar Mosque, Gjirokastër',
  'Ethnographic Museum': 'Ethnographic Museum of Gjirokastër',
  'Square of Arms': 'Trg od Oružja',
  'Katedrala Svetog Tripuna': 'Kotor Cathedral',
  'Church of Saint Luke': 'Church of St. Luke (Kotor)',
  'Crkva Svetog Nikole': 'Church of St. Nicholas, Kotor',
  'Koski Mehmed Pasha Mosque': null,
  'Crooked Bridge': 'Kriva Ćuprija',
  'Karađoz-begova džamija': 'Karađoz Bey Mosque',
  'Roman Stadium of Philippopolis': 'Stadium of Philippopolis',
  'Ancient Theatre of Philippopolis': 'Roman theatre of Philippopolis',
  'Church of St. Constantine and Helena': 'Church of Sts. Constantine and Helena (Plovdiv)',
  'Council Tower': 'Council Tower of Sibiu',
  'Podul Minciunilor': 'Bridge of Lies',
  'Lutheran Cathedral of Saint Mary': 'Sibiu Lutheran Cathedral',
  'Sioni Cathedral': 'Tbilisi Sioni Cathedral',
  'Freedom Square': 'Freedom Square, Tbilisi',
  'Cloak Bridge': null,
  'Kostel svatého Víta': 'Church of Saint Vitus (Český Krumlov)',
  'Templo Romano de Évora': 'Roman Temple of Évora',
  'Sé de Évora': 'Cathedral of Évora',
  'Igreja de São Francisco': 'Igreja de São Francisco (Évora)',
  'Universidade de Évora': 'University of Évora',
  'Tempio di Apollo': 'Temple of Apollo (Syracuse)',
  'Antico Mercato di Ortigia': null,
  'Robevi House': 'Robevi family house',
  'Church of St. Sophia': 'Church of Saint Sophia, Ohrid',
  'Samuel\'s Fortress': 'Samuel\'s Fortress, Ohrid',
  'Kaneo': 'Church of St. John at Kaneo',
  'St. Paul\'s Cathedral': 'St Paul\'s Cathedral, Mdina',
  'Carmelite Priory': 'Annunciation Church, Mdina',
  'Domus Romana': 'Domvs Romana',
  'Palais de la Berbie': 'Musée Toulouse-Lautrec',
  'Pont Vieux': null,
  'Église Saint-Salvi': null,
  'Bab Doukkala': null,
  'Museum Sidi Mohamed Ben Abdellah': 'Sidi Mohammed ben Abdallah Museum',
  'Skala du Port': 'Sqala of the Port',
  'Fiat Tagliero': 'Fiat Tagliero Building',
  'Cattedrale di Asmara': 'Church of Our Lady of the Rosary, Asmara',
  'Nda Mariam': 'Enda Mariam Cathedral, Asmara',
  'Grande Mosquée de Sousse': 'Great Mosque of Sousse',
  'Musée archéologique de Sousse': 'Sousse Archaeological Museum',
  'Bab el Finga': null,
  'Plaza Sotomayor': 'Sotomayor Square',
  'Ascensor El Peral': 'El Peral funicular',
  'La Matriz': 'Iglesia de la Matriz',
  'Catedral de San José': 'Antigua Guatemala Cathedral',
  'Palacio de los Capitanes Generales': 'Palacio de los Capitanes Generales, Antigua Guatemala',
  'La Merced': 'Iglesia de La Merced, Antigua Guatemala',
  'Convento de las Capuchinas': 'Iglesia y Convento de las Capuchinas, Antigua Guatemala',
  'Basílica de Nuestra Señora de Guanajuato': null,
  'Fort Amsterdam': 'Fort Amsterdam (Curaçao)',
  'Mikvé Israel-Emanuel': 'Curaçao Synagogue',
  'Kura Hulanda Museum': 'Kurá Hulanda Museum',
  'Igreja de Nossa Senhora do Carmo': 'Church of Our Lady of Mount Carmel (Ouro Preto)',
  'Igreja de São Francisco de Assis': 'Church of Saint Francis of Assisi (Ouro Preto)',
  'Igreja de Nossa Senhora do Pilar': 'Our Lady of the Pillar Mother Church (Ouro Preto)',
  'Parque Calderón': null,
  'Catedral de la Inmaculada Concepción': 'New Cathedral of Cuenca',
  'Catedral Vieja de Cuenca': 'Old Cathedral of Cuenca',
  'Museo Pumapungo': 'Pumapungo Museum',
  'Mercer Williams House': 'Mercer House (Savannah, Georgia)',
  'Monterey Square': 'Monterey Square (Savannah, Georgia)',
  'Cathedral of St. John the Baptist': 'Cathedral Basilica of St. John the Baptist (Savannah, Georgia)',
  'City Market': 'City Market (Savannah, Georgia)',
  'River Street': 'River Street (Savannah, Georgia)',
  'St. John\'s Anglican Church': 'St. John\'s Anglican Church (Lunenburg)',
  'Knaut-Rhuland House': 'Knaut–Rhuland House',
  'Zion Lutheran Church': 'Zion Evangelical Lutheran Church (Lunenburg)',
  'Phou Si': 'Mount Phou Si',
  'Wat Sensoukharam': 'Wat Sen',
  'National Maritime Museum': 'National Maritime Museum (Galle)',
  'Dutch Reformed Church': 'Groote Kerk, Galle',
  'Meeran Jumma Masjid': 'Meeran Jumma Mosque',
  'Galle Fort Lighthouse': 'Galle Lighthouse',
  'Bhairabnath Temple': null,
  'Pottery Square': null,
  'Oyama Shrine': 'Oyama Shrine (Kanazawa)',
  'Woljeonggyo Bridge': 'Woljeonggyo',
  'Kalta Minor': 'Kaltaminor',
  'Kunya-Ark': 'Konya Ark',
  'Juma Mosque': 'Juma Mosque, Khiva',
  'Pahlavon Mahmud Mausoleum': 'Pahlavon Mahmud Complex',
  'Tash Hauli Palace': 'Toshhovli Palace',
  'Lyab-i Hauz': 'Lab-i Hauz',
  'Alexander\'s Prison': null,
  'Yazd Water Museum': null,
  'Zoroastrian Fire Temple': 'Fire Temple of Yazd',
  'Dowlat Abad Garden': 'Dowlatabad Garden',
  'Bantay Bell Tower': 'Bantay Church',
  'Chihkan Tower': 'Fort Provintia',
  'Tainan Confucius Temple': 'Tainan Confucian Temple',
  'Tasmanian Museum and Art Gallery': 'Tasmanian Museum & Art Gallery',
  'Franklin Square': 'Franklin Square (Hobart)',
  'Round House': 'Round House (Western Australia)',
  'Fishing Boat Harbour': 'Fremantle Fishing Boat Harbour',
  'Western Australian Maritime Museum': 'Western Australian Museum',
  'Dunedin Railway Station': 'Dunedin railway station',
  'The Octagon': 'The Octagon, Dunedin',
  'St Paul\'s Cathedral': 'St Paul\'s Cathedral, Dunedin',
  'Otago Museum': 'Tūhura Otago Museum',
  'Olveston': 'Olveston (house)',
};
// Stops without a usable article: a line of our own.
const OWN_WORDS = {
  'Española Way': 'A pedestrian street of 1920s Mediterranean Revival buildings in the heart of South Beach, lined with cafés and restaurants.',
  "Place de l'Indépendance":
    "Dakar's central square, in the heart of the Plateau. Laid out in colonial times as Place Protet, after the naval officer counted as the city's founder, it took its present name after Senegal's independence; banks, ministries and the Chamber of Commerce stand around it.",
  // Off the beaten track: stops whose article isn't in English
  'Palombaro Lungo':
    "Matera's great cistern under Piazza Vittorio Veneto, dug out of the rock in the 16th century and in use until the 1920s: 15 metres deep, 50 long, it held five million litres of rainwater for a city that had no river.",
  'Madonna de Idris':
    'A rock church hollowed into the Monterrone crag above the Sasso Caveoso, with the chapel of San Giovanni in Monterrone behind it and frescoes from the 12th to the 17th century. The view over the ravine of the Gravina is the one on the postcards.',
  'Casa Grotta di Vico Solitario':
    'A cave dwelling furnished as a family lived in it until the 1950s: one room for parents, children, the mule and the hens, a cistern under the floor, a manger by the bed. It shows why the Sassi were cleared and why they were later saved.',
  "Convento di Sant'Agostino":
    'The Augustinian convent of 1592 at the northern edge of the Sasso Barisano, on a spur above the ravine. Its terrace gives the classic view of the old town, and under the church lies the rock chapel of San Giuliano.',
  'Koski Mehmed Pasha Mosque':
    "Built in 1617 on a terrace above the Neretva, Mostar's best-known mosque after the bridge: a single dome, a slender minaret you can climb, and from its courtyard the view of the Old Bridge that every photograph of the city is taken from.",
  'Cloak Bridge':
    'The covered, three-storey bridge of 1777 that links the castle to its theatre and gardens across the moat: stone arches below, timber galleries above, so that the lords of Krumlov could cross dry-shod to the Baroque theatre.',
  'Antico Mercato di Ortigia':
    'The old market hall of 1900 by the Temple of Apollo and the street market around it, where Ortigia still buys its fish, cheese, oranges and almonds every morning but Sunday.',
  'Pont Vieux':
    "Albi's old bridge over the Tarn, built in 1040 and widened in brick in the 19th century: eight arches, once lined with houses and a chapel, and for seven centuries the only crossing in the city.",
  'Église Saint-Salvi':
    "The collegiate church of Saint Salvi, Albi's first bishop, begun in the 11th century and rebuilt in brick and stone from Romanesque to Gothic. Its cloister of 1270 keeps one gallery, a quiet garden in the middle of the old town.",
  'Bab Doukkala':
    "The northern gate of the medina, named for the plain of Doukkala beyond it, where the road from Marrakesh and the buses arrive. Inside, the market street runs straight down to the harbour the way the 18th-century planners drew it.",
  'Bab el Finga':
    "A gate of the medina of Sousse by the kasbah, where the ramparts of 859 meet the souks. The name is Arabic for the gallows that stood here; today it is where the lanes of the old town come out to the modern city.",
  'Basílica de Nuestra Señora de Guanajuato':
    'The yellow basilica of 1696 on the Plaza de la Paz, home to a 7th-century wooden Virgin given to the city by Philip II of Spain. Its ochre towers are the landmark of the whole valley.',
  'Parque Calderón':
    "Cuenca's central square since the city's founding in 1557, planted with Chilean pines, with the old cathedral on one side and the blue domes of the new cathedral on the other. The city's life passes through it every day.",
  'Bhairabnath Temple':
    'The three-roofed temple of Bhairab, the fierce form of Shiva, on Taumadhi Square beside the Nyatapola. Rebuilt after the earthquakes of 1934 and 2015, it is the centre of the Bisket Jatra chariot festival each April.',
  'Pottery Square':
    "A square where Bhaktapur's potters still throw and sun-dry their work: rows of pots, bowls and piggy banks drying on the brick paving, a small temple of Ganesh to one side, and the wheels turning in the sheds behind.",
  "Alexander's Prison":
    'A 15th-century domed school with a deep round pit in its courtyard, said to be the dungeon Alexander the Great built and Hafez wrote of in a poem. Nowadays a small museum of the old quarter, next to the Tomb of the Twelve Imams.',
  'Yazd Water Museum':
    "A merchant's house of 1929 built over two qanats, the underground channels that bring mountain water across the desert. Its rooms explain how the channels were dug and kept, and you can go down to the water itself.",
};

/** The article for a stop: "<tour id>:<stop>" first (two cities have a "Plaza de Armas"), then the stop. */
function articleFor(sample, stop) {
  const key = `${sample.id}:${stop}`;
  if (key in ARTICLES) return ARTICLES[key];
  return stop in ARTICLES ? ARTICLES[stop] : stop;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// PATIENT=1 waits as long as it takes (up to ~40 minutes a story) instead of leaving a tour for later.
const PATIENT = Boolean(process.env.PATIENT);
async function summary(title) {
  for (let attempt = 0; attempt < (PATIENT ? 12 : 6); attempt++) {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {
      headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' },
    });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    await sleep(PATIENT ? Math.min(300000, 30000 * 2 ** attempt) : 3000 * 2 ** attempt);
  }
  throw new Error(`Wikipedia did not answer for ${title}`);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// These pages run no script and load only their own files: say so, so a browser refuses anything else
// (markup slipped into a Wikipedia text could then do nothing at all).
const PAGE_CSP = "default-src 'none'; img-src 'self' https://dv2788.github.io; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'";
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** The first sentences of an intro, up to about 280 characters. */
function intro(extract = '') {
  const sentences = extract.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [extract];
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > 280) break;
    out += s;
  }
  return out.trim();
}
function duration(sample) {
  const travel = sample.mode === 'drive' ? (sample.km / 20) * 60 : (sample.km / 4.5) * 60;
  const minutes = travel + sample.stops.length * (sample.mode === 'drive' ? 5 : 8);
  const halfHours = Math.max(1, Math.round(minutes / 30));
  const h = Math.floor(halfHours / 2);
  return halfHours % 2 ? (h ? `about ${h}½ hours` : 'about 30 minutes') : `about ${h} hour${h > 1 ? 's' : ''}`;
}

// ---------- Wikipedia, cached ----------

const cacheFile = new URL('tours/wiki-cache.json', ROOT);
const cache = existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, 'utf8')) : {};
// When Wikipedia is too busy to answer, a tour whose stories aren't cached yet waits for the next
// build: no page and no links to it, rather than a page without its stories. (A stop with no
// article at all still stops the build.)
const waiting = new Set();
let busy = false;
for (const sample of SAMPLES) {
  for (const stop of sample.stops) {
    const title = articleFor(sample, stop);
    if (!title || cache[title]) continue;
    const s = busy ? undefined : await summary(title).catch(() => ((busy = true), undefined));
    if (s === undefined) {
      waiting.add(sample.id);
      break;
    }
    if (!s) throw new Error(`No Wikipedia article "${title}" for ${stop}: add it to ARTICLES or OWN_WORDS`);
    cache[title] = { title: s.title, description: s.description ?? '', extract: s.extract ?? '', url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title)}` };
    console.log('fetched', title);
    await writeFile(cacheFile, JSON.stringify(cache, null, 1) + '\n'); // kept even if a later one fails
    await sleep(800);
  }
}
await mkdir(new URL('tours/', ROOT), { recursive: true });
await writeFile(cacheFile, JSON.stringify(cache, null, 1) + '\n');
for (const id of waiting) console.warn(`Wikipedia is busy: the ${id} page waits for the next build`);
/** The tours that get a page this time. */
const TOURS = SAMPLES.filter((s) => !waiting.has(s.id));
// Which ones wait (the tests and the next build go by it): PATIENT=1 npm run build:site fills them in.
await writeFile(new URL('tours/waiting.json', ROOT), JSON.stringify([...waiting].sort()) + '\n');

// ---------- One page per tour ----------

const STYLE = `
  :root { --bg: #f6f1e8; --surface: #fffdf8; --ink: #16181e; --muted: #6b665c; --gold: #7f5f25; --gold-bright: #c9a55c; --hairline: rgb(140 110 50 / 22%);
    --display: 'Cormorant Garamond', 'Iowan Old Style', Georgia, serif; --body: 'Jost', 'Avenir Next', 'Segoe UI', system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0f17; --surface: #121826; --ink: #f3eee4; --muted: #a59f93; --gold: #d4b26a; --hairline: rgb(214 185 120 / 18%); color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 300 17px/1.6 var(--body); }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 max(18px, env(safe-area-inset-right, 0px)) 64px max(18px, env(safe-area-inset-left, 0px)); }
  header { display: flex; align-items: center; gap: 12px; padding: 22px 0; border-bottom: 1px solid var(--hairline); }
  header a { display: flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; }
  header img { width: 40px; height: 40px; border-radius: 10px; }
  header span { font: 500 1.3rem var(--display); letter-spacing: 0.34em; }
  .kicker { margin: 44px 0 0; font-size: 0.74rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold); }
  h1, h2 { font-family: var(--display); font-weight: 500; text-wrap: balance; line-height: 1.08; }
  h1 { font-size: clamp(2.3rem, 7vw, 3.4rem); margin: 10px 0 14px; }
  h2 { font-size: 1.9rem; margin: 52px 0 14px; }
  .facts { color: var(--muted); margin: 0 0 18px; }
  .lede { font-size: 1.1rem; margin: 0 0 26px; max-width: 62ch; }
  .cta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 22px; }
  .btn { display: inline-block; padding: 15px 30px; border-radius: 4px; background: var(--ink); color: var(--bg); text-decoration: none; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; font-size: 0.82rem; }
  @media (prefers-color-scheme: dark) { .btn { background: linear-gradient(135deg, #e2c27a, #b8913f); color: #0b0f17; } }
  .btn:focus-visible, a:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 3px; }
  .note { color: var(--muted); font-size: 0.92rem; }
  ol.stops { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
  ol.stops li { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 14px; padding: 20px 0; border-top: 1px solid var(--hairline); }
  .num { font: italic 500 1.6rem/1 var(--display); color: var(--gold); padding-top: 4px; }
  .stop-name { font: 500 1.45rem/1.2 var(--display); margin: 0; }
  .stop-desc { margin: 2px 0 8px; color: var(--gold); font-size: 0.9rem; }
  .stop-text { margin: 0; }
  .src { font-size: 0.84rem; }
  a { color: var(--gold); }
  ul.how { padding-left: 1.2em; margin: 0; display: grid; gap: 8px; }
  .more { display: flex; flex-wrap: wrap; gap: 8px 18px; }
  footer { margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--hairline); font-size: 0.82rem; color: var(--muted); }
`;

/** "Festivals and holidays": the city's recurring events, to plan when to go (none: nothing). */
function festivals(sample) {
  const keys = new Set(cityKeys(sample.city));
  const list = EVENTS.filter((e) => e.places.some((p) => keys.has(p)));
  if (!list.length) return '';
  return `
    <h2>Festivals and holidays</h2>
    <ul class="how">
${list.map((e) => `      <li><b>${esc(e.name)}</b>, ${esc(e.usually)}. ${esc(e.note)} <a href="${esc(eventLink(e))}" rel="noopener">Check the dates</a></li>`).join('\n')}
    </ul>
`;
}

function tourPage(sample) {
  const kind = sample.mode === 'drive' ? 'driving' : 'walking';
  const stops = sample.stops.map((name) => {
    const title = articleFor(sample, name);
    const w = title ? cache[title] : null;
    return { name, description: w?.description ?? '', text: w ? intro(w.extract) : OWN_WORDS[name], url: /^https:\/\/[^\s"'<>]+$/.test(w?.url ?? '') ? w.url : null };
  });
  const pageUrl = `${SITE}tours/${sample.id}/`;
  const title = `Free audio ${kind} tour of ${sample.label}: ${sample.blurb.replace(/^California: /, '')} · Roamie`;
  const description = `A free self-guided audio ${kind} tour of ${sample.label}: ${sample.stops.join(', ')}. ${sample.km} km ${sample.mode === 'drive' ? 'by car' : 'on foot'}, narrated as you go. Nothing to install.`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: `Audio ${kind} tour of ${sample.label}: ${sample.blurb}`,
    description,
    url: pageUrl,
    touristType: 'Independent travellers',
    provider: { '@type': 'Organization', name: 'Roamie', url: SITE },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', url: `${SITE}?tour=${sample.id}` },
    itinerary: {
      '@type': 'ItemList',
      numberOfItems: stops.length,
      itemListElement: stops.map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'TouristAttraction', name: s.name, ...(s.url ? { sameAs: s.url } : {}) } })),
    },
  };
  const others = TOURS.filter((s) => s.id !== sample.id);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${pageUrl}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Roamie" />
<meta property="og:title" content="${esc(`Free audio ${kind} tour of ${sample.label} · Roamie`)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:image" content="${SITE}icons/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#0B0F17" />
<link rel="icon" href="../../icons/icon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="../../css/fonts.css" />
<style>${STYLE}</style>
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<div class="wrap">
  <header><a href="../../"><img src="../../icons/icon.svg" alt="" /><span>ROAMIE</span></a></header>
  <main>
    <p class="kicker">Free audio ${kind} tour · ${esc(sample.label)}</p>
    <h1>${esc(sample.blurb)}</h1>
    <p class="facts">${sample.stops.length} stops · ${sample.km} km ${sample.mode === 'drive' ? 'by car' : 'on foot'} · ${duration(sample)}</p>
    <p class="lede">Put your phone in your pocket: Roamie shows you the way to each stop and tells you its story as you get there${sample.mode === 'drive' ? ', hands-free while you drive' : ''}. Free, in your browser, nothing to install.</p>
    <div class="cta">
      <a class="btn" href="../../?tour=${sample.id}">Start this tour</a>
      <span class="note">Not in ${esc(sample.label)}? The app can simulate the ${sample.mode === 'drive' ? 'drive' : 'walk'}, so you can try it from your sofa.</span>
    </div>

    <h2>The stops</h2>
    <ol class="stops">
${stops
  .map(
    (s, i) => `      <li><span class="num" aria-hidden="true">${ROMAN[i]}</span><div>
        <h3 class="stop-name">${esc(s.name)}</h3>
        ${s.description ? `<p class="stop-desc">${esc(s.description)}</p>` : ''}
        <p class="stop-text">${esc(s.text ?? '')}</p>
        ${s.url ? `<a class="src" href="${esc(s.url)}" rel="noopener">More on Wikipedia</a>` : ''}
      </div></li>`,
  )
  .join('\n')}
    </ol>

${festivals(sample)}
    <h2>How it works</h2>
    <ul class="how">
      <li>Open the tour on your phone and tap <b>Begin the tour</b>. Allow location so Roamie knows where you are.</li>
      <li>A gold line on the map and a short spoken direction before each turn take you from stop to stop.</li>
      <li>As you reach each place, and the sights you pass on the way, a calm voice tells you its story. Choose a soothing guide or a documentary narrator, in English, French, Spanish, German or Italian.</li>
    </ul>

    <h2>More free audio tours</h2>
    <nav class="more" aria-label="More tours">
${others.map((o) => `      <a href="../${o.id}/">${esc(o.label)}</a>`).join('\n')}
    </nav>
  </main>
  <footer>Roamie, the city narrated: a free voice guide for walking, cycling and driving tours. Stop descriptions from <a href="https://www.wikipedia.org/" rel="noopener">Wikipedia</a> (CC BY-SA 4.0). Map data © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors. <a href="../../privacy.html">Privacy</a> · <a href="../../terms.html">Terms of use</a> · <a href="../../credits.html">Credits</a></footer>
</div>
</body>
</html>
`;
}

for (const sample of TOURS) {
  await mkdir(new URL(`tours/${sample.id}/`, ROOT), { recursive: true });
  await writeFile(new URL(`tours/${sample.id}/index.html`, ROOT), tourPage(sample));
}

// ---------- Sitemap ----------

const urls = [SITE, ...TOURS.map((s) => `${SITE}tours/${s.id}/`)];
await writeFile(
  new URL('sitemap.xml', ROOT),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}\n</urlset>\n`,
);

// ---------- robots.txt and "page not found" ----------
// (Search engines read robots.txt at the root of a domain: it counts once the site has its own.)

await writeFile(new URL('robots.txt', ROOT), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
await writeFile(
  new URL('404.html', ROOT),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Page not found · Roamie</title>
<link rel="icon" href="${SITE}icons/icon.svg" type="image/svg+xml" />
<style>
  :root { color-scheme: light dark; --bg: #f6f1e8; --ink: #16181e; --muted: #6b6a66; --gold: #9a7a3d; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0f18; --ink: #f2ede3; --muted: #a7a399; --gold: #d8b873; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 300 17px/1.6 'Jost', system-ui, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  main { max-width: 30rem; }
  img { width: 64px; height: 64px; }
  .word { letter-spacing: 0.32em; text-transform: uppercase; font: 500 1.1rem/1 Georgia, serif; margin: 14px 0 28px; }
  h1 { font: 400 2.2rem/1.15 Georgia, serif; margin: 0 0 10px; }
  p { color: var(--muted); margin: 0 0 24px; }
  a { color: var(--gold); }
  .go { display: inline-block; padding: 14px 22px; border: 1px solid var(--gold); border-radius: 12px; text-decoration: none; letter-spacing: 0.14em; text-transform: uppercase; font-size: 0.75rem; }
  nav { margin-top: 28px; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
  <img src="${SITE}icons/icon.svg" alt="" />
  <div class="word">Roamie</div>
  <h1>This street isn't on the map.</h1>
  <p>The page you were looking for doesn't exist, or has moved. The city is still out there.</p>
  <a class="go" href="${SITE}">Plan a tour</a>
  <nav>Or try a sample tour: ${TOURS.map((s) => `<a href="${SITE}tours/${s.id}/">${esc(s.label)}</a>`).join(' · ')}</nav>
</main>
</body>
</html>
`,
);

// ---------- Tour links in the home page footer ----------

const indexFile = new URL('index.html', ROOT);
const index = await readFile(indexFile, 'utf8');
const links = TOURS.map((s) => `<a href="tours/${s.id}/">${esc(s.label)}</a>`).join('\n            ');
const updated = index.replace(/(<!-- tours:start -->)[\s\S]*?(<!-- tours:end -->)/, `$1\n            ${links}\n            $2`);
if (updated === index && !index.includes('<!-- tours:start -->')) throw new Error('index.html has no <!-- tours:start --> marker');
await writeFile(indexFile, updated);

console.log(`Built ${TOURS.length} tour pages, a sitemap of ${urls.length} pages, robots.txt and 404.html for ${SITE}`);
