// Tells Bing (and through it DuckDuckGo, Yahoo, Ecosia, ChatGPT search), Yandex, Seznam and Naver
// about every page in the sitemap, via IndexNow: no account needed. Run it after the site is live
// and after big changes. (Google doesn't use IndexNow: submit the sitemap in Search Console.)
// Usage: npm run indexnow
import { readFile, readdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const sitemap = await readFile(new URL('sitemap.xml', ROOT), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const site = urls[0];
const keyFile = (await readdir(ROOT)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('No IndexNow key file (32 hex characters + .txt) at the root of the site');
const key = keyFile.slice(0, -4);

const check = await fetch(new URL(keyFile, site));
if (!check.ok) throw new Error(`The site isn't live yet (${new URL(keyFile, site)} answered ${check.status}). Switch on GitHub Pages first.`);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: new URL(keyFile, site).href, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} pages`, res.ok ? '(accepted)' : await res.text());
