# Real street photos in first person: Google Street View

In first person, Roamie can show Google's photos of the street you're on (Street View) instead
of the 3D map: the real façades, with the stops and places as signposts on the photo, facing
the way the street goes. Where Google has no photos (a park path, a new street), the 3D map
takes over, and back again.

It is **off until a Google key is set** in `js/streetview-config.js`. Without it nothing
changes: first person stays the 3D map, and nothing is sent to Google.

## What it costs

Google Maps Platform, "Dynamic Street View": **5,000 viewer loads a month free**, then
$14 per 1,000 ([price list](https://developers.google.com/maps/billing-and-pricing/pricing)).
Roamie opens **one viewer per tour** (it keeps it while the tour runs, even when you switch to
the map and back), and asking Google *where* the nearest photo is isn't billed. So up to about
5,000 tours a month cost nothing; a month with 10,000 tours would cost about $70.

A Google Cloud billing account (a card) is needed even for the free part. Set a budget alert and
a quota cap (below) so it can never surprise you.

## Set it up (about 15 minutes)

1. **Google Cloud console**, [console.cloud.google.com/google/maps-apis](https://console.cloud.google.com/google/maps-apis/overview):
   sign in, create a project ("Roamie"), and link a billing account (Billing → create one, with a card).
2. **Enable the API**: APIs & Services → Library → *Maps JavaScript API* → Enable.
3. **Create a key**: Google Maps Platform → Keys & Credentials → Create credentials → API key. Then
   edit the key:
   - *Application restrictions*: **Websites**, and add `https://dv2788.github.io/*` (and later
     `https://heyroamie.com/*` when the site moves). With this, the key only works on Roamie's pages.
   - *API restrictions*: **Restrict key** → only *Maps JavaScript API*.
4. **Put the key in the app**: open `js/streetview-config.js` on GitHub, set `apiKey: 'AIza…'`,
   commit. GitHub Pages publishes it within a minute or two. (A browser key is meant to be in the
   page; the restriction above is what protects it.)
5. **Protect your spending**:
   - Billing → Budgets & alerts → a budget of, say, €5 a month with an email alert.
   - APIs & Services → Maps JavaScript API → Quotas: cap the daily *map loads* / Street View
     loads at about 160 a day (≈ 5,000 a month) if you want a hard stop at the free amount.

To switch it off again, empty `apiKey`.

## Google's rules Roamie follows

From the [Maps Platform terms](https://cloud.google.com/maps-platform/terms), section 3.2.4:

- **No non-Google map on the same screen as Street View.** Roamie's maps are OpenStreetMap-based,
  so while a photo shows, Roamie's maps are hidden: the top map underneath and the 3D map. The
  user sees one or the other, never both. (The planning map is on the setup screen, not the tour screen.)
- **Attribution stays.** Google's logo and credits sit at the bottom corners of the photo; Roamie's
  "Map" button moves to the middle so it never covers them, and the direction card is at the top.
- **No caching, no pre-fetching, no storing.** Roamie keeps nothing of Google's: each photo is
  requested as you get there, and the offline copy of the app never includes Google content.
- **Privacy.** With Street View on, Google receives the position along the tour (to find the photo)
  and the browser's IP address, under Google's privacy policy. The terms page says so.

Google's own viewer ("Report a problem", "Terms") stays as it is.

## How it's built

- `streetview.html` + `js/streetview-frame.js`: a separate page with its own, looser security
  policy (Google's script needs inline styles and its hosts). The app's own page keeps its strict
  policy and shows this page in a frame. The page only runs inside the app, from the app's own
  address, and only with a key set.
- `js/photoView.js`: the app's side. Messages carry where you are and which way the street goes,
  the stops and places; back comes whether Google has a photo here. Every message is checked on
  arrival, both ways (`parseCommand`, `parseReport`), and only messages from the app's own address count.
- The camera faces along the route (the same street heading as the 3D view); if you look around by
  hand, it leaves you be for 8 seconds, then follows the street again.
- Tests: `npm test` (the message checks) and `npm run e2e:streetview` (a tour with a stand-in for
  Google's script: one viewer per tour, signposts on the photo, the 3D map where there's no photo,
  the maps hidden while a photo shows).
