# Moving Roamie to its own address (heyroamie.com)

Why: today Roamie shares `dv2788.github.io` with any other GitHub Pages site on the account, so
they would share saved data and permissions. Its own address fixes that, lets the site send real
security headers (`_headers`), turns on the short-link expander (`functions/api/resolve-link.js`),
and gives every post, card and Google listing a link that never has to change. Do it before the
launch posts.

## 1. You (about 20 minutes, ~$10–12 a year)

1. **Check the name first:** search "Roamie" in EUIPO's TMview and the USPTO trademark search
   (travel apps, class 9/39/41). Nothing close: go ahead.
2. **Cloudflare account** (free) → *Domain registration* → buy `heyroamie.com`.
3. *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → repository `dv2788/Tour-guide-App-`:
   - production branch: `claude/city-tour-guide-app-nrb6vy`
   - framework preset: none; build command: empty; build output directory: `/`
4. In the new Pages project → *Custom domains* → add `heyroamie.com` (and `www.heyroamie.com`).
   Cloudflare sets the DNS itself because it also holds the domain.
5. Tell me when `https://heyroamie.com/` shows Roamie.

Keep two-step login on for Cloudflare and GitHub.

## 2. Me (about 30 minutes, then your approval to publish)

1. `node scripts/move-site.mjs https://heyroamie.com/ --dry`, then without `--dry`: every link,
   the tour pages, sitemap, 404 page and QR cards point to the new address, and visitors of the old
   address are sent on (`js/moved.js`).
2. README: say where the site lives now.
3. Full tests, then the security attack again, against the live new address (headers, framing,
   policy), and the old address sending visitors on.
4. Google Search Console and Bing Webmaster Tools: verify `heyroamie.com` (you sign in; a DNS
   record in Cloudflare is the simplest proof), submit `https://heyroamie.com/sitemap.xml`.

## Afterwards

- GitHub Pages can stay on: its copy sends app visitors to the new address and its tour pages
  name the new address as the real one (canonical). Switch it off later if you prefer
  (repository *Settings → Pages → Source: none*); the old links then stop working.
- Before switching Plus on: the Polar checkout's success address becomes
  `https://heyroamie.com/?plus=thanks` (docs/plus.md).

## If something goes wrong

The move is one commit: revert it and push, and the github.io address works as before.
Cloudflare Pages keeps every deployment; *Rollback* in its dashboard restores the previous one.
