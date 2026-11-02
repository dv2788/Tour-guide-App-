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
};
// Stops without a usable article: a line of our own.
const OWN_WORDS = {
  'Española Way': 'A pedestrian street of 1920s Mediterranean Revival buildings in the heart of South Beach, lined with cafés and restaurants.',
  "Place de l'Indépendance":
    "Dakar's central square, in the heart of the Plateau. Laid out in colonial times as Place Protet, after the naval officer counted as the city's founder, it took its present name after Senegal's independence; banks, ministries and the Chamber of Commerce stand around it.",
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
