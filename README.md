# Tour Guide 🎧

**Your phone becomes a tour guide.** Paste your route from Google Maps, Apple Maps or Waze (or type
your stops), then put the phone in your pocket or on the dashboard. As you walk, run, cycle or drive, a
calm voice tells you about the places you pass. No tour guide or travel agency needed.

> "On your left: Hôtel de la Marine. Designed by Ange-Jacques Gabriel and built between 1757 and 1774…"

## Try it

It's a web app (works on any phone browser, nothing to install, no account, no API keys).

```bash
npm start            # serves the app on http://localhost:8080 (needs Python 3)
```

Open it, tap **"Fill in a sample Paris walk"**, then **Start tour**. Simulation mode drives a virtual
you along the route, so you can hear a tour of Paris from your couch. Tap **▶ Listen** next to *Voice* to
hear the soothing voice first.

**On your phone:** location only works over HTTPS. The easiest way is GitHub Pages
(repo **Settings → Pages → Deploy from a branch**, pick this branch and `/ (root)`). Open the URL on your
phone, choose **Use my phone's GPS**, and go outside. You can also "Add to Home Screen": it installs like an app.

## Paste your route from any maps app

Plan your trip where you already do, then **Share → Copy** and tap **📋 Paste from a maps app** (or paste
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

## A soothing voice

By default the guide uses a **natural, calm AI voice that runs on the phone itself**
([Piper](https://github.com/rhasspy/piper)): free, private (nothing you hear is sent anywhere), and it works
offline after a one-time ~80 MB download. Two voices per language were picked by measuring pitch, steadiness,
pace and harshness across the whole voice collection. See **[docs/voices.md](docs/voices.md)** for the
comparison and [listen to the samples](docs/voice-samples/). The app also speaks a little slower than usual,
pauses gently between sentences and softens harsh high frequencies.

Prefer no download? Pick one of the phone's own voices. The calmest ones are listed first. If the AI voice is
still downloading or ever fails, the phone's voice takes over without a gap.

## How it works

| Step | What happens | Powered by |
| --- | --- | --- |
| 1. Plan | Your city and stops are found on the map | OpenStreetMap (Nominatim) |
| 2. Move | Your position comes from GPS, or from a simulated trip along a real walking/cycling/driving route | Geolocation API, routing.openstreetmap.de |
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

- Arriving at a stop interrupts any other story: *"You have arrived at Grand Palais… Next stop: Place de la Concorde, 650 meters away."*
- Big places count as reached when you get to their edge, not their centre point (the Louvre is 600 m long).
- Stops are detected along the whole path you travelled, so fast driving or a weak GPS signal can't skip one.
- Visiting stops out of order works. No itinerary at all also works ("free roam").
- The guide uses the names you typed, and picks the bridge "Pont de l'Alma", not the station named after it.

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
js/app.js             screen wiring, map (Leaflet)
js/tourEngine.js      decides what to say and when (no DOM: fully unit-tested)
js/narration.js       builds the sentences the guide says
js/narrator.js        what to say next: queue, pause/skip/repeat, priority for arrivals, voice fallback
js/neuralVoice.js     the on-device AI voice (Piper on ONNX Runtime Web), warm EQ, caching
js/voices.js          voice catalogue, calm built-in voice ranking, pronunciation fixes
js/itineraryImport.js reading routes pasted from maps apps and plain lists
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
npm test             # unit tests (Node 18+): geo math, text cleanup, the tour engine, Wikipedia/OSM parsing
npm run e2e          # browser runs on a phone-sized screen: the Paris walk, and a pasted Google Maps route
npm run e2e:voice    # the AI voice for real: download, preview, and a tour read by it (needs internet)
```

The browser test answers network requests from `tests/e2e/fixtures.json`: real OpenStreetMap and Wikipedia
data recorded by `node tests/e2e/build-fixtures.mjs`. Run it with `LIVE=1` to use the real services instead.

## Known limits of this prototype

- **Screen must stay on.** Browsers pause web pages when the screen locks. The app keeps the screen awake,
  but a native app (iOS/Android) is needed to keep talking with the screen off, or to show up in CarPlay / Android Auto.
- **The AI voice is an 80 MB download** the first time (Wi-Fi recommended), and very old phones may be too
  slow for it. The phone's own voice is used meanwhile or instead.
- **Free public services** (Nominatim, routing.openstreetmap.de, OpenStreetMap tiles) are fine for trying this
  out, but not for thousands of users. A real launch needs paid or self-hosted equivalents.
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

Place information © [Wikipedia](https://www.wikipedia.org/) contributors (CC BY-SA). Map data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Map display by [Leaflet](https://leafletjs.com/).
Voices: [Piper](https://github.com/rhasspy/piper) and the [piper-voices](https://huggingface.co/rhasspy/piper-voices)
collection (see each voice's model card for its dataset licence), running on
[ONNX Runtime Web](https://onnxruntime.ai/), with the espeak-ng phonemizer build from
[@diffusionstudio/piper-wasm](https://www.npmjs.com/package/@diffusionstudio/piper-wasm).
