// Browser test of the AI voices, end to end and in real time: tap "Listen", load the new
// voice (Supertonic, ≈110 MB, served by the app itself) and the lighter Piper voice (≈80 MB,
// downloaded for real: needs internet), check speech is actually played, then run the start
// of a tour with the narrator. Map and Wikipedia answers come from fixtures.
// Usage: node tests/e2e/voice.cjs

const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork, saveRouteCaches, cspBlocked } = require('./mocks.cjs');

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await mockNetwork(context, { routeCacheName: 'voice' });
  // Count the seconds of audio actually handed to the speakers.
  await context.addInitScript(() => {
    window.__played = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && this.buffer.duration > 0.1) window.__played.push(this.buffer.duration);
      return start.apply(this, args);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const failures = [];
  const expect = (ok, msg) => ok || failures.push(msg);
  const played = () => page.evaluate(() => window.__played.reduce((a, b) => a + b, 0));

  await page.goto(base);
  const voice = await page.$eval('input[name=voice]:checked', (el) => el.value);
  console.log('Default voice:', voice);
  expect(voice === 'neural:supertonic-3:F1', 'the new AI voice (Nora) is the default');

  // 1. Preview the calm voices (new and lighter), then the documentary narrator
  const preview = async (value, name) => {
    const card = `.guide[data-value="${value}"]`;
    const before = await played();
    const t0 = Date.now();
    await page.click(`${card} .listen`);
    await page.waitForFunction((sel) => /On your phone/.test(document.querySelector(`${sel} .guide-status`).textContent), card, { timeout: 180000 });
    const ready = ((Date.now() - t0) / 1000).toFixed(1);
    await page.waitForFunction((b) => window.__played.reduce((a, x) => a + x, 0) > b + 3, before, { timeout: 60000 });
    console.log(`${name}: downloaded and ready in ${ready} s, speech is playing`);
  };
  await preview('neural:supertonic-3:F1', 'Nora');
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '6-guides.png'), fullPage: true });
  await preview('neural:en_GB-jenny_dioco-medium:0', 'Jenny (Piper)');
  await preview('neural:supertonic-3:M2', 'Victor (narrator)');

  // 2. A tour read by the narrator (the voice is now cached on the "phone")
  await page.click('#demo');
  await page.click('.guide[data-value="neural:supertonic-3:M2"] label');
  await page.selectOption('#sim-speed', '1');
  const before = await played();
  await page.click('button[type=submit]');
  // Documentary phrasing: "Welcome to Barcelona. Let us take a closer look." then "And so, we arrive at…"
  await page.waitForFunction(() => /^Welcome to Barcelona\. Let us take a closer look\./.test(document.getElementById('now-text').textContent), null, {
    timeout: 60000,
  });
  await page.waitForFunction(() => /^And so, we arrive at Casa Batlló/.test(document.getElementById('now-text').textContent), null, {
    timeout: 120000,
  });
  await page.waitForTimeout(3000);
  const tourAudio = (await played()) - before;
  const label = await page.$eval('#now-label', (el) => el.textContent);
  console.log(`Now playing label: "${label}"`);
  expect(/Victor|arrived/i.test(label), 'the player shows the guide by name');
  const voiceLine = await page.$eval('#voice-line', (el) => (el.hidden ? '' : el.textContent));
  console.log(`Tour: welcome + arrival, ${tourAudio.toFixed(1)} s of speech played${voiceLine ? `; note: ${voiceLine}` : ''}`);
  expect(tourAudio > 15, `the AI voice read the welcome (only ${tourAudio.toFixed(1)} s played)`);
  expect(!voiceLine, `no fallback to the phone's voice (${voiceLine})`);
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '5-ai-voice-tour.png') });
  expect(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  const blocked = await cspBlocked(page);
  expect(blocked.length === 0, `the content security policy blocked nothing (got ${blocked.join(' | ')})`);

  await browser.close();
  saveRouteCaches();
  server.close();
  if (failures.length) {
    console.error('\nFAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('All voice checks passed.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
