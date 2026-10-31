<img src="icons/icon.svg" alt="" width="72" height="72" />

# Roamie

**The city, narrated.** Paste your route from Google Maps, Apple Maps or Waze (or type your
stops) or let Roamie curate a route, pick your guide, and put the phone in your pocket or on the dashboard.
As you walk, run, cycle or drive, a private voice guide shows you the way and tells you the stories of the
places you pass. No tour guide or travel agency needed.

> "You have arrived at Casa Batlló. It was designed by Antoni Gaudí, and is considered one of his masterpieces…"

## Try it

It's a web app (works on any phone browser, nothing to install, no account, no API keys).

```bash
npm start            # serves Roamie on http://localhost:8080 (needs Python 3)
```

Open it, pick one of the **sample tours** at the top (or tap **"or try a sample tour of Barcelona"**), then
**Begin the tour**. "Try from the couch" drives a virtual you along the route, so you can hear a tour of
Barcelona, Cape Town or Tokyo from home. Tap **▶** on any guide to hear them first.

### Sample tours

Ready to try, and real tours: each was checked against the live services (every stop found on the map under
this name, a real route joining them, a Wikipedia article for each). Use them from the sofa or on the spot.

| City | Tour | Stops |
| --- | --- | --- |
| **Barcelona** | Gaudí, La Rambla and the Gothic Quarter · 3 km on foot | Casa Batlló, Plaça de Catalunya, La Boqueria, Plaça Reial, Barcelona Cathedral, Santa Maria del Mar |
| **Brussels** | From Manneken Pis to the Royal Palace · 2.3 km | Manneken Pis, Grand-Place, Galeries Royales Saint-Hubert, the cathedral, Mont des Arts, Royal Palace |
| **Cape Town** | The Castle, the old city and the Bo-Kaap · 2.9 km | Castle of Good Hope, City Hall, Greenmarket Square, Bo-Kaap Museum, St. George's Cathedral, Company's Garden |
| **Kinshasa** | A drive past the landmarks of Lingwala and Gombe · 16 km by car | Palais du Peuple, Stade des Martyrs, Notre-Dame du Congo, the botanical garden, Palais de la Nation |
| **Miami Beach** | Art Deco South Beach · 2.9 km | Art Deco Welcome Center, Casa Casuarina (Versace mansion), The Wolfsonian–FIU, Española Way, Lincoln Road |
| **Paris** | From the Eiffel Tower to the Louvre · 4.5 km | Eiffel Tower, Pont de l'Alma, Grand Palais, Place de la Concorde, Louvre |
| **San Francisco** | California: the Ferry Building up to Coit Tower · 3.7 km | Ferry Building, Transamerica Pyramid, Dragon Gate, Washington Square, Coit Tower |
| **Shenzhen** | Lotus Hill to the Ping An tower · 4 km | Lianhuashan Park, Shenzhen Library, Civic Center, Shenzhen Museum, Ping An Finance Center |
| **Tokyo** | Asakusa's temples to the Skytree · 2.9 km | Kaminarimon, Sensō-ji, Asakusa Shrine, Sumida Park, Tokyo Skytree |

They live in `js/samples.js`; any city works the same way: type your own stops, paste a route, or let Roamie
curate one.

**Online:** Roamie is published with GitHub Pages at **https://dv2788.github.io/Tour-guide-App-/** once Pages
is switched on (repo **Settings → Pages → Build and deployment → Deploy from a branch**, branch
`claude/city-tour-guide-app-nrb6vy`, folder `/ (root)`, **Save**). Every push to that branch then updates the
site within a minute or two. Open the link on your phone, choose **Use my phone's GPS**, and go outside
(location needs HTTPS, which Pages provides). "Add to Home Screen" installs it like an app. Links to it show
a preview card (`icons/og-image.jpg`); if you move to your own domain, update the `og:` tags in `index.html`.
Short map links (`maps.app.goo.gl/…`) need the small Cloudflare function in `functions/`, so on GitHub Pages
paste the full link instead.

**Launching it:** the ad, the visuals, ready-to-paste copy and a launch plan are in [`marketing/`](marketing/).

### Getting found on Google

The site is ready for search engines:

- **A page per sample tour** (`tours/barcelona/`, `tours/cape-town/`…), written for what people search
  ("free audio walking tour of Barcelona"), with each stop described from Wikipedia and a **Start this tour**
  button that opens the app with the tour loaded (`?tour=barcelona`, also handy to share).
- **A sitemap** (`sitemap.xml`), structured data (schema.org `WebApplication` on the home page, `TouristTrip` on
  each tour page), canonical addresses, link previews, and the tour pages linked from the home page footer.
- `npm run build:site` regenerates the tour pages, the sitemap and the footer links after editing
  `js/samples.js` (a test checks they stay in sync).

Google only accepts new sites through **Google Search Console**, which needs your Google account:

1. Switch on GitHub Pages (above) and check the site opens.
2. Go to https://search.google.com/search-console, **Add property → URL prefix**, and enter
   `https://dv2788.github.io/Tour-guide-App-/`.
3. Choose the **HTML tag** method and copy the code it shows (`<meta name="google-site-verification" …>`). Add it
   to `index.html` next to the other `<meta>` tags (or send it to Claude to add), push, wait a minute, then click
   **Verify**.
4. Open **Sitemaps**, enter `sitemap.xml`, **Submit**.
5. Open **URL inspection**, paste the home page address, click **Request indexing**. Do the same for a couple of
   tour pages.

Pages usually appear within a few days to two weeks. For Bing (which also feeds DuckDuckGo, Yahoo, Ecosia and
ChatGPT search), run `npm run indexnow` once the site is live: no account needed. A domain of your own
(`roamie.app`, say) would rank and read better than a `github.io` address; if you get one, rebuild with
`SITE_URL=https://your.domain/ npm run build:site` and update the `og:` and canonical tags in `index.html`.

## Let Roamie plan it: "Suggest a route for me"

Tap **Use my location** (or type your city), then **Suggest a route for me** and answer one question:
**how long do you want to be out?** (30 min, 1 hour, 2 hours, half a day or a full day). **Select range** sets
how far to look for monuments, museums and landmarks: "Fits my time" (the default, worked out from the time and
way of getting around), or any distance on the slider from 500 m to 50 km (beyond 10 km, Wikipedia's search for
notable places does the looking). If nothing fits, it says why and offers the way out ("Plan 1 hour instead", "Look within 3 km").

Where the route starts: **the part of town you're staying in**, if you tell it (a neighbourhood, your hotel or
a street; the box suggests the city's neighbourhoods, best known first, from Wikipedia). Otherwise where you
are, or, if you've typed another city (planning tomorrow's trip from home), that city's centre. Then it:

- **picks the places most worth seeing**: it searches both the nearest places and the most notable ones
  anywhere within reach (in a dense centre like London's, the nearest few hundred articles only cover a few
  streets). Fame comes first, measured by how many Wikipedia languages have an article about a place (the
  Sagrada Família ~95, a neighbourhood church ~5), then how much there is to tell, with a nudge for
  churches, palaces, monuments and museums (recognised in all five languages);
- **skips what isn't a stop**: streets, districts and whole cities, metro stations, stub articles,
  organisations and events that Wikipedia places at an address (an intelligence agency, an Olympic Games),
  buildings that no longer exist ("palace (1564–1883)"), objects inside a museum (the Elgin Marbles: the
  British Museum is the stop), and near-duplicates;
- **balances fame against walking**: it adds, one at a time, the place worth the most for the minutes it
  adds, so a must-see a little further away still makes it, but the walk isn't spent crossing town;
- **puts museums on the route** when there's time to go inside (about an hour each, one for half a day, two
  for a full day), and stays quiet while you visit;
- **adds food and drink at the right time**: lunch around 12:30, dinner around 19:45, a coffee or a drink in
  the longest stretches without a break. It reads opening hours and skips places that will be closed, prefers
  independent and notable places (a historic café with its own Wikipedia article) over chains, picks the right
  kind (a restaurant for lunch, a bar for a drink), offers up to three alternatives ("Another place"), and
  links to reviews in Google Maps;
- orders everything into an efficient loop back to where you started (or one-way), fitted to your time and
  way of getting around, and shows it as a timeline with times and a map. You can still edit the list.

Places come from Wikipedia; cafés, restaurants and bars from OpenStreetMap (Overpass, falling back to
Nominatim). Wikipedia allows a web page at most 3 requests at a time, so the app sends at most 2 (a shared
queue in `js/wiki.js`), finds places in two requests, waits and retries when Wikipedia asks it to, and says
"Wikipedia didn't answer" rather than "nothing nearby" when it can't get through. The planning logic is in `js/suggest.js` (pure functions, unit-tested).

## Finding your way to the next stop

During the tour Roamie shows and tells you how to reach the next stop:

- a bold **gold line** from where you are to the next stop on the map (the rest of the route fades back);
- a **direction card**: the next turn with its arrow ("In 80 m, turn left onto Rue de Rivoli"), plus the next
  stop, the distance and the walking time;
- a short **spoken direction** just before each turn. A story in progress pauses for it and then carries on
  from the same sentence; the first "head east…" after a stop waits until the stop's story is finished.
  Spoken turns are off when driving (use your car's navigation);
- **re-routing** when you take a wrong turn (said straight away), and after the last stop of a round trip,
  the way back to where you started;
- an **open in Maps** button that hands the next stop to Apple Maps (iPhone) or Google Maps for full navigation.

Directions come from the same open routing service used for planning (OSRM on routing.openstreetmap.de), in
all five languages. The logic is in `js/navigation.js`.

**Directions a person would give.** OpenStreetMap maps many pavements and crossings as separate little
paths, so a raw walking route is full of "turn left, 5 m, turn right" zig-zags, and most of its paths have no
name. Read literally, that's a stream of confusing orders. Roamie describes the route the way a person would:

- maneuvers a few meters apart are merged, and the real change of direction is measured on the line itself:
  a zig-zag that leaves you going the same way (crossing a street, stepping onto the pavement) isn't said;
  a path that curves round a corner before the junction is still a turn;
- two turns the same way round a corner are said as two turns, never as "turn around";
- unnamed pavements get the name of the street they run along (the nearest named road), so "turn left"
  becomes "turn left onto Avenue d'Iéna";
- a GPS jump is not a wrong turn: Roamie re-routes only after a few positions in a row off the route, and
  allows for the accuracy the phone reports;
- a stop set back from every path (in a garden, behind a building) counts as reached from as close as the
  path gets;
- without an answer from the route service, it retries with growing pauses, and never draws a straight line
  through buildings as if it were the way.

Checked on real walking routes in Paris, London, New York, Rome, Barcelona, Tokyo, Marrakech and Kinshasa
(`tests/fixtures/routes/`): every real change of direction at a junction gets an instruction, each said once
and before you reach it, with no re-routing while you're on the route. A simulation with a drifting GPS
error of ±15 m reached every destination; one with a wrong turn on each walk re-routed every time.

**A sharp map.** The map is drawn on the phone from vector data
([OpenFreeMap](https://openfreemap.org), built from OpenStreetMap; free, no account, no key), so it stays crisp
at any zoom and on any screen, down to every pavement, crossing and building outline. It opens at street
level around the way ahead, in an ivory day style or a midnight-blue night style, without the bus-stop and
shop clutter. Your dot sits on the route while you follow it (GPS wanders a few meters into buildings; your
path doesn't). Phones that can't draw vector maps get OpenStreetMap's map images instead.

**How fresh is the map?** Roamie doesn't keep its own copy of the map: every map, route and street name is
fetched live from OpenStreetMap data, which volunteers update every minute. Place search (Nominatim) follows
within minutes, the routing service rebuilds its road network roughly every two days, and the vector map is
rebuilt every week (the copy in use today is from 25 October 2026).

## Paste your route from any maps app

Plan your trip where you already do, then **Share → Copy** and tap **Paste a route from a maps app** (or paste
into the itinerary box). The app reads:

| From | What gets imported |
| --- | --- |
| **Google Maps** | All stops of a route (with exact coordinates), places, searches, the travel mode. Every Google domain (`google.fr`, `maps.google.co.uk`…), old and new link styles |
| **Apple Maps** | Multi-stop routes (new `maps.apple.com/directions` links and older ones), places, the travel mode |
| **Waze** | Shared drives and places (`waze.com/ul/…`, live-map links); always driving mode |
| **OpenStreetMap, Bing Maps, HERE WeGo** | Routes and places, travel mode |
| **Anything else** | `geo:` links, coordinates, and plain lists: one per line, numbered, bulleted, `Eiffel Tower → Louvre`, "Directions from X to Y". Turn-by-turn steps and durations are ignored |

"My location" as a starting point is understood (the tour starts wherever you are). Stops that come only as
coordinates are named by looking up what's there. If you haven't typed a city, it's worked out from the
stops.

**Short links** (`maps.app.goo.gl/…`, `maps.apple/…`, what phone apps usually share) hide the full route
behind a redirect that web pages can't follow. The included server function `functions/api/resolve-link.js`
expands them. It runs automatically if the app is hosted on **Cloudflare Pages** (free: connect the repo,
no build command, output directory `/`). On hosts without it (GitHub Pages, `npm start`), the app explains
how to copy the full link instead, and still uses any place names shared alongside the link.

## Choose your guide

Two kinds of guide, in every language:

- **Calm guides** (Jenny, Amy, Siwis, Claude, Kerstin, Paola…): soft, steady, unhurried.
- **Documentary narrators** (Arthur, Pierre, Marcos, Thorsten): a deep, slow storyteller in the spirit of
  classic nature documentaries, with long pauses and their own way of telling it: *"And here, on your
  left… Casa Batlló."* An original voice, not an imitation of any real person.

All of them are **natural AI voices that run on the phone itself**
([Piper](https://github.com/rhasspy/piper)): free, private (nothing you hear is sent anywhere), and it works
offline after a one-time ~80 MB download. They were picked by measuring pitch, steadiness, pace and harshness
across the whole voice collection, and checking every one with a speech recognizer. See
**[docs/voices.md](docs/voices.md)** for the comparison and [listen to the samples](docs/voice-samples/).

Prefer no download? Pick one of the phone's own voices. The calmest ones are listed first. If the AI voice is
still downloading or ever fails, the phone's voice takes over without a gap.

## How it works

| Step | What happens | Powered by |
| --- | --- | --- |
| 1. Plan | Your city and stops are found on the map | OpenStreetMap (Nominatim) |
| 2. Move | Your position comes from GPS, or from a simulated trip that follows the directions along real streets | Geolocation API, routing.openstreetmap.de |
| 3. Look around | Places near you with a Wikipedia article are fetched as you go | Wikipedia geosearch |
| 4. Decide | The guide picks the best nearby place: close, notable (has a photo), not behind you, not already told, not a metro station | `js/tourEngine.js` |
| 5. Talk | It says where it is ("on your right") and tells its story, in your language | Wikipedia + an on-device AI voice (or the phone's own) |

### Each way of travelling gets its own guide

| Mode | Talks about places within | Story length | Extras |
| --- | --- | --- | --- |
| 🚶 Walk | 80 m | 4 sentences | |
| 🏃 Run | 100 m | 2 sentences | Longer pauses, so you can focus |
| 🚴 Cycle | 150 m | 3 sentences | |
| 🚗 Drive | 350 m | 2 sentences | Announces distance ("on your right, in 300 meters"), ignores what you've already passed, hands-free |

### Your itinerary comes first

- Arriving at a stop interrupts any other story: *"You have arrived at Plaça Reial… Next stop: Barcelona Cathedral, 450 meters away."*
- Big places count as reached when you get to their edge, not their centre point (the Louvre is 600 m long).
- Stops are detected along the whole path you travelled, so fast driving or a weak GPS signal can't skip one.
- Visiting stops out of order works. No itinerary at all also works ("free roam").
- The guide uses the names you typed ("Plaça Reial", not OpenStreetMap's English "Royal Square"), and picks
  the square "Plaça de Catalunya", not the metro station under it.

### Also

- **Languages:** English, Français, Español, Deutsch, Italiano (stories come from that language's Wikipedia, voices are native speakers' models).
- **Controls:** Pause, Skip, Repeat, End. Big buttons, because you might be wearing gloves or holding a coffee.
- **Pace:** Relaxed, Normal or Brisk.
- **Trip journal:** a list of everything you heard about, with links to read more later.
- **Keeps the screen awake** during the tour (Wake Lock API), and works offline once loaded (service worker). Map and stories still need data.
- **Light and dark mode.**

## Project layout

```
index.html            the two screens: plan the trip, then on tour
css/styles.css
js/app.js             screen wiring, map (Leaflet + MapLibre vector maps)
js/samples.js         the sample tours
js/tourEngine.js      decides what to say and when (no DOM: fully unit-tested)
js/narration.js       builds the sentences the guide says
js/narrator.js        what to say next: queue, pause/skip/repeat, priority for arrivals, voice fallback
js/neuralVoice.js     the on-device AI voice (Piper on ONNX Runtime Web), warm EQ, caching
js/voices.js          voice catalogue, calm built-in voice ranking, pronunciation fixes
js/itineraryImport.js reading routes pasted from maps apps and plain lists
js/suggest.js         suggested routes: interest scoring, museum visits, meal breaks, route order
js/openingHours.js    reading OpenStreetMap opening hours
js/navigation.js      directions to the next stop: route, next turn, spoken prompts, re-routing
js/wiki.js            Wikipedia: nearby places, stories, matching a stop to its article
js/geocode.js         OpenStreetMap: finding places, routes
js/location.js        GPS and the trip simulator
js/geo.js             distances, bearings, left/right
js/text.js            cleaning text for listening, filtering boring places
js/i18n.js            languages and the guide's phrases
js/modes.js           walk / run / cycle / drive settings
functions/api/resolve-link.js  expands short map links (Cloudflare Pages Function)
docs/voices.md        how the voices were chosen, with samples
```

Plain JavaScript modules: no framework, no build step.

## Tests

```bash
npm test             # unit tests (Node 18+): geo math, text cleanup, the tour engine, Wikipedia/OSM parsing,
                     # directions on real walking routes in 8 cities
npm run e2e          # browser runs on a phone-sized screen: the Barcelona walk, a pasted Google Maps route,
                     # and "use my location" + a suggested half-day route with a museum visit and meals
npm run e2e:voice    # the AI voice for real: download, preview, and a tour read by it (needs internet)
```

The browser test answers place searches and Wikipedia from `tests/e2e/fixtures.json` (real data recorded by
`node tests/e2e/build-fixtures.mjs`). Routes and street names always come from the real routing service, so
the map and the directions show real streets; each answer is recorded in `tests/e2e/routes-*.json`, which
answers instead when the service can't be reached (or with `OFFLINE=1`). `LIVE=1` uses every real service.
Screenshots of each run are saved in `tests/e2e/screenshots/`.

## Known limits of this prototype

- **Screen must stay on.** Browsers pause web pages when the screen locks. The app keeps the screen awake,
  but a native app (iOS/Android) is needed to keep talking with the screen off, or to show up in CarPlay / Android Auto.
- **The AI voice is an 80 MB download** the first time (Wi-Fi recommended), and very old phones may be too
  slow for it. The phone's own voice is used meanwhile or instead.
- **Free public services** (Nominatim, routing.openstreetmap.de, OpenFreeMap, OpenStreetMap tiles) are fine for
  a first launch, but not for heavy use. Growth needs paid or self-hosted equivalents.
- **Mainland China:** Wikipedia (the stories) is blocked on Chinese networks. Visitors with a foreign SIM or
  eSIM on roaming, or a VPN, get the full tour (that's how most travellers connect there); on Chinese Wi-Fi or a
  local SIM, the map and directions may work but the stories won't.
- **Directions are only as good as OpenStreetMap.** It's very complete in most cities, but a missing footpath
  or a wrong one-way street means a detour. Anyone can fix the map at openstreetmap.org; the routing service
  picks up fixes within about two days.
- Content is Wikipedia's intro paragraphs: accurate, but encyclopedic rather than storyteller-style.

## Where this could go next

1. **Native app** with background location and audio (screen off, pocket mode, CarPlay / Android Auto).
2. **A real storyteller:** use an LLM (such as Claude) to turn Wikipedia facts into a lively, guide-style script,
   adapted to the listener (kids, history buffs, foodies) and to how much time there is before the next turn.
3. **Even more human voices** from cloud text-to-speech (needs a paid account and a small server).
4. **"Hey guide, what's that?"** Ask questions by voice while moving.
5. **Themed tours:** street art, film locations, architecture, food, "Paris in 1900"…
6. **Offline city packs** for travellers without roaming data.
7. **Business model ideas:** free with Wikipedia content; premium for storyteller narration, themes, offline packs;
   partnerships with hotels and car rental companies.

## Credits

Icons: [Material Symbols](https://fonts.google.com/icons) (Apache 2.0). Fonts: [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) and [Jost](https://fonts.google.com/specimen/Jost) (SIL OFL).
Place information © [Wikipedia](https://www.wikipedia.org/) contributors (CC BY-SA). Map data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Map display by [Leaflet](https://leafletjs.com/) and [MapLibre](https://maplibre.org/); vector maps by
[OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://www.openmaptiles.org/).
Voices: [Piper](https://github.com/rhasspy/piper) and the [piper-voices](https://huggingface.co/rhasspy/piper-voices)
collection (see [docs/voices.md](docs/voices.md) for each voice's dataset licence; the Arthur voice uses the
VCTK corpus, CC BY 4.0, CSTR, University of Edinburgh), running on
[ONNX Runtime Web](https://onnxruntime.ai/), with the espeak-ng phonemizer build from
[@diffusionstudio/piper-wasm](https://www.npmjs.com/package/@diffusionstudio/piper-wasm).
