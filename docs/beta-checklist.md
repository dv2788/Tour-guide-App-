# Beta checklist: 1.0.0-beta.1

What "ready to publish" means, and where each item stands. ✓ done · ◻ needs you · ✗ not yet.

## Works
- ✓ Unit tests green (`npm test`).
- ✓ Browser tests green: the Barcelona walk, a pasted Google Maps route, a suggested half-day,
  the AI voice, the camera, Plus (off), outings and itineraries, first person, Street View (stand-in).
- ✓ Outings by interest tried in 34 cities in five languages against real Wikipedia, overnight:
  1,054 outings (7 interest sets × 5 kinds per city). 88% came back with itineraries; the rest
  are honest "nothing here" answers, almost all food or landscapes in small towns (Chamonix,
  Dubrovnik, Monterosso, Annecy, Waterloo) or within an hour's walk. Three rounds of fixes
  (places by what they are, summits and islands off on foot, demolished places out, a refused
  Wikipedia search asked again); 2,300 flagged problems went down to 159, nearly all of them
  a famous landmark on the way or a war memorial the checker wrongly suspected.
- ✓ Stop times checked across those cities: no statue gets an hour, no cathedral gets five minutes.
- ✓ What the guide says, checked on sample tours in five languages: the definition folded into the arrival,
  the full lead section at stops, no statistics, names in the listener's language, nothing told twice.
- ✓ New AI voice (Supertonic 3, all five languages): 8-bit copy checked against the full model, every
  language transcribed word for word by a speech recognizer, numbers written out, speed adapts to the phone.
- ✓ Live site re-checked after every push.

## Safe
- ✓ Security review of the app and its back end; "try to break in" test; score 8.5/10
  (about 9 on its own domain with the prepared Cloudflare headers).
- ✓ Street View page isolated: own policy, checked messages, runs only inside the app.
- ✓ Privacy page, terms, credits and licences in place; nothing stored off the phone.

## Packaged
- ✓ Version 1.0.0-beta.1 in the app's footer, with "Beta" and "Report a problem".
- ✓ Release notes: `docs/release-notes.md`.
- ✓ The offline copy (service worker) updated to the beta's files.

## Needs you (each is a few minutes, and only on your say-so)
- ◻ **Publish the release on GitHub**: say "go" and I tag `v1.0.0-beta.1` and create the release
  with the notes above.
- ◻ **Testers**: who gets the link first. Feedback comes in as GitHub issues ("Report a problem"
  in the app); if you'd rather have email, give me an address to use instead of GitHub.
- ◻ **Street View photos**: a Google key (`docs/street-view.md`). Without it, first person is the 3D map.
- ◻ **Own domain**: buy heyroamie.com and connect it (`docs/domain.md`); then I move the site.
- ◻ **Name check** for "Roamie" (trade marks in your main markets).
- ◻ **Launch day** (8 December, moved back a week for more polish): the posts in the launch kit, from your accounts.
- ◻ **Plus**: Polar details, a commercial routing service, a business registration (`docs/plus.md`).
