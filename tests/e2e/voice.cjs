// Browser test of the soothing AI voice, end to end and in real time: tap "Listen",
// download the voice for real (≈80 MB, needs internet), check speech is actually played,
// then run the start of a tour with it. Map and Wikipedia answers come from fixtures.
// Usage: node tests/e2e/voice.cjs

const path = require('node:path');
const { chromium } = require('playwright');
const { serve, mockNetwork } = require('./mocks.cjs');

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await mockNetwork(context);
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
  const voice = await page.$eval('#voice', (el) => el.value);
  console.log('Default voice:', voice);
  expect(voice === 'neural:en_GB-jenny_dioco-medium:0', 'the soothing AI voice is the default');

  // 1. Preview
  const t0 = Date.now();
  await page.click('#voice-preview');
  await page.waitForFunction(() => /Downloaded/.test(document.getElementById('voice-status').textContent), null, { timeout: 180000 });
  console.log(`Downloaded and ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForFunction(() => window.__played.reduce((a, b) => a + b, 0) > 3, null, { timeout: 60000 });
  console.log(`Preview: ${(await played()).toFixed(1)} s of speech played`);

  // 2. A tour with the AI voice (the voice is now cached on the "phone")
  await page.click('#demo');
  await page.selectOption('#sim-speed', '1');
  const before = await played();
  await page.click('button[type=submit]');
  await page.waitForFunction(() => /^You have arrived at Eiffel Tower/.test(document.getElementById('now-text').textContent), null, {
    timeout: 120000,
  });
  await page.waitForTimeout(3000);
  const tourAudio = (await played()) - before;
  const voiceLine = await page.$eval('#voice-line', (el) => (el.hidden ? '' : el.textContent));
  console.log(`Tour: welcome + arrival, ${tourAudio.toFixed(1)} s of speech played${voiceLine ? `; note: ${voiceLine}` : ''}`);
  expect(tourAudio > 15, `the AI voice read the welcome (only ${tourAudio.toFixed(1)} s played)`);
  expect(!voiceLine, `no fallback to the phone's voice (${voiceLine})`);
  await page.screenshot({ path: path.join(__dirname, 'screenshots', '5-ai-voice-tour.png') });
  expect(errors.length === 0, `no page errors (${errors.join(' | ')})`);

  await browser.close();
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
