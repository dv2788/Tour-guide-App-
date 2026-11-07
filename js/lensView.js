// "Point your camera": the camera as a viewfinder, with the landmarks, monuments and streets in
// front of you labelled. Tap one to read about it or hear its story, or ask to be guided to a
// place: an arrow shows which way to turn, and when it's in front of you, its story pops up.
// Where things are comes from GPS and the compass (see js/lens.js), not from the image.

import { cameraHeading, smoothHeading, compassJitter, placesInView, placesAround, whereItIs, screenFov } from './lens.js';
import { distanceMeters, bearingDegrees, angleDiff } from './geo.js';
import { storySentences, polish, plainTitle } from './story.js';
import { photoPage } from './wiki.js';
import { declination, trueHeading } from './declination.js';

const $ = (id) => document.getElementById(id);
const REFETCH_AFTER_M = 40; // look for places again after moving this far
const FOUND_WITHIN_DEG = 12; // the place you're looking for is "found" this close to the centre…
const FOUND_FOR_MS = 600; // …for this long (not just swept past)
const COMPASS_WAIT_MS = 2500;
const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * @param wiki        Wikipedia service (nearby, summary, resolveArticle)
 * @param streetName  (point) => Promise<string|null>
 * @param narrator    () => a Narrator to speak with (the tour's, or a new one)
 */
export function createLens({ wiki, streetName, narrator }) {
  let state = null; // everything about the open view; null when closed

  // Keyboard: Escape closes the story window, then the camera view.
  function onKey(e) {
    if (e.key !== 'Escape' || !state) return;
    e.preventDefault();
    if (!$('lens-popup').hidden) {
      $('lens-popup').hidden = true;
      $('lens-close').focus();
    } else close();
  }

  function close() {
    if (!state) return;
    const opener = state.opener;
    document.removeEventListener('keydown', onKey);
    state.closed = true;
    state.stream?.getTracks().forEach((t) => t.stop());
    if (state.watch != null) navigator.geolocation?.clearWatch(state.watch);
    window.removeEventListener('deviceorientationabsolute', state.onOrient);
    window.removeEventListener('deviceorientation', state.onOrient);
    clearTimeout(state.compassTimer);
    clearTimeout(state.retryTimer);
    $('lens-video').srcObject = null;
    $('lens').hidden = true;
    document.body.classList.remove('lens-open');
    state = null;
    opener?.focus?.(); // back to where you were
  }

  /** Open the camera view; with a target ({ name, lat, lon, … }), guide the way to it. Call from a tap. */
  async function open({ target = null } = {}) {
    close();
    const s = (state = { places: [], heading: null, position: null, target: null, best: null, foundAt: null, popped: new Set(), opener: document.activeElement });
    // iPhone asks for the compass separately, and only during a tap: ask first, before any wait.
    const compassAsk = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission().catch(() => 'denied')
      : Promise.resolve('granted');
    $('lens').hidden = false;
    document.body.classList.add('lens-open');
    document.addEventListener('keydown', onKey);
    $('lens-close').focus();
    $('lens-popup').hidden = true;
    $('lens-card').hidden = true;
    $('lens-street').hidden = true;
    $('lens-labels').replaceChildren();
    setTarget(target);
    status('Starting the camera…');

    s.recent = [];
    s.onOrient = (e) => {
      const h = cameraHeading(e); // relative to magnetic north
      if (h == null || s.closed) return;
      if (s.magnetic == null) clearTimeout(s.compassTimer);
      s.magnetic = smoothHeading(s.magnetic, h);
      s.heading = trueHeading(s.magnetic, s.declination);
      s.compass = true;
      // How far to trust it: the iPhone says (degrees, -1 = needs calibrating); otherwise, how
      // much it has wavered over the last second and a half.
      const now = performance.now();
      s.recent.push({ at: now, h });
      while (s.recent.length && now - s.recent[0].at > 1500) s.recent.shift();
      const ios = Number.isFinite(e.webkitCompassAccuracy) ? e.webkitCompassAccuracy : null;
      s.compassError = ios != null && ios >= 0 ? ios : null;
      s.unsteady = ios === -1 || (ios ?? 0) > 25 || (s.recent.length >= 8 && compassJitter(s.recent.map((r) => r.h)) > 90);
      draw();
    };
    window.addEventListener('deviceorientationabsolute', s.onOrient);
    window.addEventListener('deviceorientation', s.onOrient);
    s.compassTimer = setTimeout(() => {
      if (s.closed || s.heading != null) return;
      s.compass = false;
      draw();
    }, COMPASS_WAIT_MS);

    if (navigator.geolocation) {
      s.watch = navigator.geolocation.watchPosition(
        (pos) => moved(s, { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => !s.closed && status(err?.code === 1 ? 'Allow location for this site so I know what you’re looking at.' : 'Waiting for your position…', 'warn'),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    } else status("This browser can't share your location, so I can't tell what you're looking at.", 'warn');

    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (s.closed) return s.stream.getTracks().forEach((t) => t.stop());
      $('lens-video').srcObject = s.stream;
      await $('lens-video').play().catch(() => {});
    } catch {
      if (!s.closed) status('The camera is off, but pointing the phone still works.', 'warn');
    }
    const compass = await compassAsk;
    if (!s.closed && compass !== 'granted') status('Allow motion & orientation access so I know which way you’re pointing.', 'warn');
    if (!s.closed && !s.position) status(s.target ? `Looking for ${s.target.name}…` : 'Finding where you are…');
  }

  async function moved(s, position) {
    if (s.closed) return;
    const first = !s.position;
    s.position = position;
    // Compasses point to magnetic north, maps to true north: the difference where you are
    // (1° in Paris, 27° in Cape Town). Once per city is plenty.
    if (s.declination == null || distanceMeters(s.declinationAt, position) > 50000) {
      s.declination = declination(position.lat, position.lon);
      s.declinationAt = position;
      if (s.magnetic != null) s.heading = trueHeading(s.magnetic, s.declination);
    }
    if (first || !s.fetchedAt || distanceMeters(s.fetchedAt, position) > REFETCH_AFTER_M) {
      s.fetchedAt = position;
      clearTimeout(s.retryTimer);
      status(s.target ? `Looking for ${s.target.name}…` : 'Looking for landmarks around you…');
      wiki
        .nearby(position.lat, position.lon, 400, 50, { markGone: true })
        .then((places) => {
          if (s.closed) return;
          s.places = places;
          s.retries = 0;
          if (!places.length) status('No landmarks known within 400 m. Try walking a little further.');
          draw();
          // Then the closest ones' categories: some demolished buildings are only marked there.
          const close = places.filter((p) => p.category !== 'skip' && !p.gone && distanceMeters(position, p) <= 300).slice(0, 40);
          wiki.markDemolished?.(close).then(() => !s.closed && draw(), () => {});
        })
        .catch(() => {
          if (s.closed) return;
          // Ask again in a moment, even if you stand still (5 s, 10 s, 20 s, then every 30 s).
          const wait = Math.min(30000, 5000 * 2 ** (s.retries ?? 0));
          s.retries = (s.retries ?? 0) + 1;
          status(`Wikipedia didn't answer just now. Trying again in ${Math.round(wait / 1000)} seconds…`, 'warn');
          s.retryTimer = setTimeout(() => {
            if (s.closed) return;
            s.fetchedAt = null;
            moved(s, s.position);
          }, wait);
        });
      showStreet(s, position);
    }
    draw();
  }

  /** "You're on Passeig de Gràcia": the street you're in, if it has a story. */
  async function showStreet(s, position) {
    const name = await Promise.resolve(streetName(position)).catch(() => null);
    if (s.closed || !name || name === s.street?.name) return;
    const article = await wiki.resolveArticle({ name, lat: position.lat, lon: position.lon }, { maxDistance: 1500 }).catch(() => null);
    if (s.closed) return;
    s.street = { name, article };
    const chip = $('lens-street');
    chip.hidden = false;
    chip.replaceChildren(
      el('span', { textContent: `You're on ${name}` }),
      ...(article ? [el('button', { type: 'button', className: 'text-btn', textContent: 'Its story', onclick: () => popup({ name, title: article.title }, article) })] : []),
    );
  }

  function setTarget(target) {
    if (!state) return;
    state.target = target ? { ...target, name: target.name ?? target.title } : null;
    state.foundAt = null;
    $('lens-guide').hidden = !state.target;
    if (state.target) $('lens-target-name').textContent = state.target.name;
    draw();
  }

  function status(text, tone = '') {
    const p = $('lens-status');
    p.hidden = !text;
    p.textContent = text ?? '';
    p.dataset.tone = tone;
  }

  let frame = 0;
  function draw() {
    if (!state || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (state) render(state);
    });
  }

  function render(s) {
    if (!s.position) return;
    const compass = s.heading != null;
    const headingError = Math.min(25, Math.max(5, s.compassError ?? 5));
    // How wide the picture on screen really is, so labels sit over the place they name.
    const video = $('lens-video');
    const fov = screenFov({ videoWidth: video.videoWidth, videoHeight: video.videoHeight, width: video.clientWidth, height: video.clientHeight }) ?? 60;
    const inView = compass ? placesInView(s.position, s.heading, s.places, { headingError, fov }) : placesAround(s.position, s.places);
    if (s.places.length && !s.target) {
      // Say when the labels may be off, and what helps.
      const hints = [];
      if (!compass) hints.push("No compass on this phone: here's what's around you, nearest first.");
      else if (s.unsteady) hints.push('The compass is unsteady: wave your phone in a figure 8 to calibrate it.');
      if ((s.position.accuracy ?? 0) > 50) hints.push(`Your position is only known to about ${Math.round(s.position.accuracy / 10) * 10} m here, so labels may be off. It gets better in the open.`);
      status(hints.join(' '), compass && hints.length ? 'warn' : '');
    }

    // Labels on the camera image, where each place stands (nearer ones lower down), below the
    // "Looking for…" banner when there is one.
    const shown = inView.slice(0, 6);
    const top = s.target ? 36 : 18;
    $('lens-labels').replaceChildren(
      ...shown.map((p, i) =>
        el(
          'button',
          {
            type: 'button',
            className: `lens-label${i === 0 ? ' best' : ''}${s.target && sameName(p, s.target) ? ' target' : ''}`,
            // (Anchored by the same fraction of its own width, so a label at the edge stays on screen.)
            style: compass ? `left:${(p.x * 100).toFixed(1)}%; transform:translateX(-${(p.x * 100).toFixed(1)}%); top:${top + Math.min(4, i) * 8}%` : `left:50%; top:${top + i * 8}%`,
            onclick: () => choose(p),
          },
          [el('strong', { textContent: p.title }), el('span', { textContent: whereItIs(p) })],
        ),
      ),
    );

    // The card at the bottom: the place in the middle of the view.
    const best = inView[0] ?? null;
    if (best && (!s.best || s.best.title !== best.title)) {
      s.best = best;
      const card = $('lens-card');
      card.hidden = false;
      card.replaceChildren(
        el('div', { className: 'lens-card-text' }, [el('strong', { textContent: best.title }), el('span', { textContent: [best.description, whereItIs(best)].filter(Boolean).join(' · ') })]),
        el('div', { className: 'lens-card-actions' }, [
          el('button', { type: 'button', className: 'btn-soft btn-small', textContent: 'Read more', onclick: () => choose(best) }),
          el('button', { type: 'button', className: 'btn-soft btn-small', textContent: 'Guide me there', onclick: () => setTarget({ ...best, name: best.title }) }),
        ]),
      );
    } else if (!best) {
      s.best = null;
      $('lens-card').hidden = true;
    }

    if (s.target) guide(s, compass);
  }

  /** The arrow to the place you're looking for, and the pop-up when it's right in front of you. */
  function guide(s, compass) {
    const t = s.target;
    const distance = distanceMeters(s.position, t);
    const bearing = bearingDegrees(s.position, t);
    const arrow = $('lens-arrow');
    let where;
    if (distance <= 30) where = "You're there";
    else if (!compass) where = `${roundMeters(distance)} to the ${COMPASS_POINTS[Math.round(bearing / 45) % 8]}`;
    else {
      const off = angleDiff(s.heading, bearing);
      arrow.style.transform = `rotate(${Math.max(-150, Math.min(150, off)).toFixed(0)}deg)`;
      where = Math.abs(off) <= FOUND_WITHIN_DEG ? `Ahead · ${roundMeters(distance)}` : `Turn ${off < 0 ? 'left' : 'right'} · ${roundMeters(distance)}`;
      // Found: in the middle of the view for a moment (not just swept past), or reached.
      const centred = Math.abs(off) <= FOUND_WITHIN_DEG && distance <= 600;
      if (centred) s.foundAt ??= performance.now();
      else s.foundAt = null;
    }
    arrow.hidden = !compass || distance <= 30;
    $('lens-target-where').textContent = where;
    const found = distance <= 30 || (s.foundAt != null && performance.now() - s.foundAt >= FOUND_FOR_MS);
    $('lens-guide').classList.toggle('found', found);
    if (found && !s.popped.has(t.name)) {
      s.popped.add(t.name);
      status(`Found ${t.name}`);
      choose(t);
    } else if (s.foundAt != null && !found) setTimeout(draw, FOUND_FOR_MS); // check again once the moment has passed
  }

  /** A place was chosen (tapped, or found): show its story in the little window. */
  async function choose(place) {
    const s = state;
    if (!s) return;
    const name = place.name ?? place.title;
    popup({ name, title: place.title }, null);
    // Places from Wikipedia have a title; tour stops have a name and maybe a Wikipedia link.
    const summary = await (place.title ? wiki.summary(place.title) : wiki.resolveArticle(place, { maxDistance: 2000 })).catch(() => null);
    if (state !== s || $('lens-popup').dataset.name !== name) return;
    popup({ name, title: place.title }, summary);
  }

  function popup({ name }, summary) {
    const box = $('lens-popup');
    const opening = box.hidden;
    box.hidden = false;
    box.tabIndex = -1;
    box.dataset.name = name;
    const text = summary?.extract ? polish(storySentences(summary.extract, { count: 5, maxChars: 700, lang: wiki.lang ?? 'en' }).join(' '), wiki.lang ?? 'en') : summary === null ? 'Looking it up…' : '';
    box.replaceChildren(
      ...(summary?.thumbnail ? [el('img', { src: summary.thumbnail, alt: '', className: 'lens-popup-img', loading: 'lazy', decoding: 'async' })] : []),
      el('h3', { textContent: summary?.title ?? name }),
      ...(summary?.description ? [el('p', { className: 'lens-popup-desc', textContent: summary.description })] : []),
      el('p', { className: 'lens-popup-text', id: 'lens-text', textContent: text || "Wikipedia has nothing about this place yet." }),
      // Credit for Wikipedia's text (CC BY-SA) and the photo's author and licence (on its page).
      ...(summary?.url
        ? [
            el('p', { className: 'lens-popup-credit' }, [
              el('a', { href: summary.url, target: '_blank', rel: 'noopener', textContent: 'From Wikipedia' }),
              ' · ',
              el('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/', target: '_blank', rel: 'noopener', textContent: 'CC BY-SA 4.0' }),
              ...(photoPage(summary.thumbnail) ? [' · ', el('a', { href: photoPage(summary.thumbnail), target: '_blank', rel: 'noopener', textContent: 'Photo credit' })] : []),
            ]),
          ]
        : []),
      el('div', { className: 'lens-popup-actions' }, [
        ...(summary?.extract
          ? [el('button', { type: 'button', className: 'btn-primary btn-small', textContent: 'Hear its story', onclick: () => tell(summary) })]
          : []),
        ...(summary?.url ? [el('a', { className: 'btn-soft btn-small', href: summary.url, target: '_blank', rel: 'noopener', textContent: 'Read more ↗' })] : []),
        el('button', { type: 'button', className: 'text-btn', textContent: 'Close', onclick: () => ((box.hidden = true), $('lens-close').focus()) }),
      ]),
    );
    if (opening) box.focus(); // screen readers and keyboards land on the story
  }

  function tell(summary) {
    const voice = narrator();
    voice.unlock?.(); // inside the tap, so phones allow the sound
    const story = polish(storySentences(summary.extract, { count: 6, maxChars: 750, lang: wiki.lang ?? 'en' }).join(' '), wiki.lang ?? 'en');
    voice.speak(`${plainTitle(summary.title)}. ${story}`, { kind: 'poi', title: summary.title, thumbnail: summary.thumbnail, url: summary.url }, { priority: true, interrupt: true });
  }

  return { open, close, setTarget, get isOpen() { return Boolean(state); } };
}

const sameName = (p, t) => (p.title ?? p.name) === (t.title ?? t.name) || (p.title ?? '').startsWith(t.name);
const roundMeters = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
