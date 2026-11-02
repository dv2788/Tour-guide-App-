// Moves Roamie to its own address in one step (run it once the domain serves the site):
//   node scripts/move-site.mjs https://heyroamie.com/ --dry   (shows what would change)
//   node scripts/move-site.mjs https://heyroamie.com/         (changes it)
// Rewrites every link to the old github.io address, rebuilds the tour pages, sitemap and 404
// page for the new address, regenerates the QR cards (needs `pip install segno`), and switches
// on the redirect from the old address (js/moved.js). Commit and push afterwards.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OLD = 'https://dv2788.github.io/Tour-guide-App-/';
const OLD_SHORT = 'dv2788.github.io/Tour-guide-App-';
const [arg, flag] = process.argv.slice(2);
const dry = flag === '--dry';
if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/$/.test(arg ?? '')) {
  console.error('Usage: node scripts/move-site.mjs https://new-domain.example/ [--dry]');
  process.exit(1);
}
const NEW = arg;
const NEW_ORIGIN = NEW.slice(0, -1);
const ROOT = new URL('../', import.meta.url);

// Files that name the address by hand (the generated pages are rebuilt below).
const FILES = ['index.html', 'marketing/launch-kit.html', 'marketing/README.md', 'docs/plus.md', 'scripts/build-site.mjs', 'scripts/make-cards.py'];
for (const file of FILES) {
  const url = new URL(file, ROOT);
  const before = await readFile(url, 'utf8');
  let after = before.replaceAll(OLD, NEW);
  if (file === 'scripts/build-site.mjs') after = after.replace("img-src 'self' https://dv2788.github.io", `img-src 'self' ${NEW_ORIGIN}`);
  after = after.replaceAll(OLD_SHORT, NEW_ORIGIN.replace('https://', ''));
  const n = before.split('dv2788.github.io').length - 1;
  console.log(`${n ? 'change' : 'same  '} ${file}${n ? ` (${n} mentions)` : ''}`);
  if (!dry && before !== after) await writeFile(url, after);
}

// The redirect from the old address.
const moved = new URL('js/moved.js', ROOT);
const movedSrc = await readFile(moved, 'utf8');
console.log(`change js/moved.js (send visitors from ${OLD} to ${NEW})`);
if (!dry) await writeFile(moved, movedSrc.replace("export const MOVED_TO = '';", `export const MOVED_TO = '${NEW}';`));

if (dry) {
  console.log('\nDry run: nothing written. Then: tour pages, sitemap, robots.txt, 404 and QR cards rebuilt for', NEW);
} else {
  const env = { ...process.env, SITE_URL: NEW };
  execFileSync('node', ['scripts/build-site.mjs'], { cwd: ROOT, env, stdio: 'inherit' });
  execFileSync('python3', ['scripts/make-cards.py'], { cwd: ROOT, env, stdio: 'inherit' });
  console.log(`\nMoved to ${NEW}. Now: npm test, commit, push; then check ${NEW} and that ${OLD} sends you there.`);
}
