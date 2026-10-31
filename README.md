# Tour Guide 🎧

**Your phone becomes a tour guide.** Tell it which city you're staying in and where you're going.
Then put the phone in your pocket or on the dashboard. As you walk, run, cycle or drive, a voice tells
you about the places you pass. No tour guide or travel agency needed.

> "On your left: Hôtel de la Marine. Designed by Ange-Jacques Gabriel and built between 1757 and 1774…"

## Try it

It's a web app (works on any phone browser, nothing to install, no account, no API keys).

```bash
npm start            # serves the app on http://localhost:8080 (needs Python 3)
```

Open it, tap **"Fill in a sample Paris walk"**, then **Start tour**. Simulation mode drives a virtual
you along the route, so you can hear a tour of Paris from your couch.

**On your phone:** location only works over HTTPS. The easiest way is GitHub Pages
(repo **Settings → Pages → Deploy from a branch**, pick this branch and `/ (root)`). Open the URL on your
phone, choose **Use my phone's GPS**, and go outside. You can also "Add to Home Screen": it installs like an app.

## How it works

| Step | What happens | Powered by |
| --- | --- | --- |
| 1. Plan | Your city and stops are found on the map | OpenStreetMap (Nominatim) |
| 2. Move | Your position comes from GPS, or from a simulated trip along a real walking/cycling/driving route | Geolocation API, routing.openstreetmap.de |
| 3. Look around | Places near you with a Wikipedia article are fetched as you go | Wikipedia geosearch |
| 4. Decide | The guide picks the best nearby place: close, notable (has a photo), not behind you, not already told, not a metro station | `js/tourEngine.js` |
| 5. Talk | It says where it is ("on your right") and tells its story, in your language | Wikipedia + the phone's built-in text-to-speech |

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

- **Languages:** English, Français, Español, Deutsch, Italiano (stories come from that language's Wikipedia).
- **Controls:** Pause, Skip, Repeat, End. Big buttons, because you might be wearing gloves or holding a coffee.
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
js/narrator.js        text-to-speech queue: pause/skip/repeat, priority for arrivals
js/wiki.js            Wikipedia: nearby places, stories, matching a stop to its article
js/geocode.js         OpenStreetMap: finding places, routes
js/location.js        GPS and the trip simulator
js/geo.js             distances, bearings, left/right
js/text.js            cleaning text for listening, filtering boring places
js/i18n.js            languages and the guide's phrases
js/modes.js           walk / run / cycle / drive settings
```

Plain JavaScript modules: no framework, no build step.

## Tests

```bash
npm test             # unit tests (Node 18+): geo math, text cleanup, the tour engine, Wikipedia/OSM parsing
npm run e2e          # full browser run of the Paris walk on a phone-sized screen (needs Playwright + Chromium)
```

The browser test answers network requests from `tests/e2e/fixtures.json`: real OpenStreetMap and Wikipedia
data recorded by `node tests/e2e/build-fixtures.mjs`. Run it with `LIVE=1` to use the real services instead.

## Known limits of this prototype

- **Screen must stay on.** Browsers pause web pages when the screen locks. The app keeps the screen awake,
  but a native app (iOS/Android) is needed to keep talking with the screen off, or to show up in CarPlay / Android Auto.
- **Voice quality depends on the phone's built-in voices.** iPhones and recent Android phones sound good. Some
  desktops have no voice installed; the app then shows the text only.
- **Free public services** (Nominatim, routing.openstreetmap.de, OpenStreetMap tiles) are fine for trying this
  out, but not for thousands of users. A real launch needs paid or self-hosted equivalents.
- Content is Wikipedia's intro paragraphs: accurate, but encyclopedic rather than storyteller-style.

## Where this could go next

1. **Native app** with background location and audio (screen off, pocket mode, CarPlay / Android Auto).
2. **A real storyteller:** use an LLM (such as Claude) to turn Wikipedia facts into a lively, guide-style script,
   adapted to the listener (kids, history buffs, foodies) and to how much time there is before the next turn.
3. **Natural voices** (neural text-to-speech) instead of the phone's built-in ones.
4. **"Hey guide, what's that?"** Ask questions by voice while moving.
5. **Themed tours:** street art, film locations, architecture, food, "Paris in 1900"…
6. **Offline city packs** for travellers without roaming data.
7. **Business model ideas:** free with Wikipedia content; premium for storyteller narration, themes, offline packs;
   partnerships with hotels and car rental companies.

## Credits

Place information © [Wikipedia](https://www.wikipedia.org/) contributors (CC BY-SA). Map data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Map display by [Leaflet](https://leafletjs.com/).
