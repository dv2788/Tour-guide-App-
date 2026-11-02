# Roamie Plus

A one-time purchase that opens every city and every voice. The code is in the app, **switched off**
until the Polar details are filled in (`js/plus-config.js`). While it's off, nothing is locked, shown or
remembered.

## What's free and what's Plus

| Free, always | Roamie Plus (€9.99 once, VAT included) |
| --- | --- |
| Your first city: as many real tours there as you like (anything within 25 km counts as the same city) | Real tours in every other city |
| Every tour "from the couch" (simulated), in any city | |
| One AI voice per language (Jenny (Dioco), Siwis, Claude, Kerstin, Paola) and the phone's own voices | Every voice, including the documentary narrators (Arthur, Pierre, Marcos, Thorsten) |
| Directions, stories, the camera view, festivals, suggestions | |

Why this shape: travellers use a guide for a few days at a time, so a subscription would feel unfair.
One payment that covers every future trip is easy to say yes to, and costs about what a single paid
audio tour or a museum audio guide does. The first city stays free so that everyone can try Roamie
properly, and the tour pages ("audio walking tour of Marrakesh") keep their promise.

A key works on up to 3 phones. Buyers can free a phone themselves in Polar's customer portal, or with
"Remove Plus from this phone" in the app.

## How it works

- **Payment: Polar** (polar.sh) is the *seller of record*. It sells Plus on Roamie's behalf, charges and
  pays the VAT in every country, sends the receipt and the key, and handles refunds. You receive the
  money minus fees: 5% + $0.50 per sale, +1.5% for non-US cards (Starter plan, November 2026), plus
  Stripe's payout fees. On €9.99 that leaves roughly €7 after VAT and fees for a French buyer.
- **The key** is checked with Polar's public licence API (`api.polar.sh/v1/customer-portal/license-keys`),
  which is meant to be called straight from an app: no server of ours, no secret in the page. On unlock
  the phone is "activated" on the key, so the 3-phone limit holds. Every 7 days, when online, the key is
  checked again: a refunded key, or a phone freed in the portal, stops working. No signal, a timeout or a
  busy server never removes Plus.
- **Stored on the phone** (and removed by "Forget everything"):
  - `roamie:plus`: the key, the activation id, the dates.
  - `roamie:cities`: the free city's name and position to about 1 km (only while Plus is on and not bought).
- **Honest limits:** everything runs on the phone, so someone determined could get round the lock. A
  fair price, and no account or adverts, keep honest people paying.

## To switch it on

### 1. Set up Polar (you, about 30 minutes)

1. Create an account at polar.sh and an organisation called Roamie. Finish the payout set-up (identity
   and bank account, through Stripe).
2. Settings → Payments → tax behaviour: **location-based** (prices include VAT in Europe). Check that
   you can price in euros. If not, use a dollar price and tell me so the app shows the same price.
3. Products → New product **"Roamie Plus"**: one-time price **€9.99**. Add the benefit **License keys**
   with prefix `ROAMIE`, an **activation limit of 3**, and no expiry.
4. Create a **checkout link** for it, with the success URL
   `https://dv2788.github.io/Tour-guide-App-/?plus=thanks` (the app then asks for the key).
5. Send me three things. None of them is a secret, and they will be visible in the app's code anyway:
   - the organisation ID (Settings → a UUID)
   - the checkout link (`https://buy.polar.sh/…`)
   - your customer portal address (`https://polar.sh/<your-org>/portal`)

### 2. Before the first sale (blocking)

- **Directions (routing):** the free server Roamie uses (routing.openstreetmap.de, sponsored by FOSSGIS)
  is "restricted to reasonable, non-commercial use-cases" (OSRM wiki, Demo server). The rules of the
  previous demo server, "still good practice", add: "Access to the demo server shall not be behind a
  paywall". It has to be replaced before Roamie charges anything. Geoapify's free plan (3,000 requests a
  day) allows commercial apps. You create the account and add the key in the environment settings, then
  I switch the code over and re-record the test routes.
- **Place suggestions (Overpass):** the public Overpass server asks apps for the general public to run
  their own instance. Geoapify's Places API can take this over with the same key.
- **Map search (Nominatim):** commercial use isn't forbidden, but it's "at your own risk" for paying
  customers. Sample tours no longer use it. Geoapify's geocoding can replace it too.
- **Business:** selling needs a registered business (in France, for example, a micro-entreprise). Its
  details must appear in the legal notice.
- **Wording:** at the switch-on, update the terms ("Roamie is free: no purchases…"), the privacy page
  (Polar, the key, the free city), the footer and tour pages ("free voice guide", "Free audio tours"),
  and the launch kit's "Roamie is free" lines. I'll make these changes in the same update.

### 3. Switch on

Fill in `js/plus-config.js` and publish. Then check it in the app: buy Plus once with a 100% discount
code made in Polar, unlock it, and refund yourself.

## Tests

- `tests/plus.test.js`: the rules (free voice, free city, key answers, weekly check, removal, broken storage).
- `npm run e2e:plus`: the whole flow in a browser, with Plus switched on and Polar's API answered by the
  test. Also checks that nothing changes while Plus is off.
