// "Point your camera": the camera as a viewfinder, with the landmarks, monuments and streets in
// front of you labelled. Tap one to read about it or hear its story, or ask to be guided to a
// place: an arrow shows which way to turn, and when it's in front of you, its story pops up.
// Where things are comes from GPS and the compass (see js/lens.js), not from the image.

import { cameraHeading, smoothHeading, placesInView, placesAround, whereItIs } from './lens.js';
import { distanceMeters, bearingDegrees, angleDiff } from './geo.js';
import { firstSentences } from './text.js';

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

  function close() {
    if (!state) return;
    state.closed = true;
    state.stream?.getTracks().forEach((t) => t.stop());
    if (state.watch != null) navigator.geolocation?.clearWatch(state.watch);
    window.removeEventListener('deviceorientationabsolute', state.onOrient);
    window.removeEventListener('deviceorientation', state.onOrient);
    clearTimeout(state.compassTimer);
    $('lens-video').srcObject = null;
    $('lens').hidden = true;
    document.body.classList.remove('lens-open');
    state = null;
  }

  /** Open the camera view; with a target ({ name, lat, lon, … }), guide the way to it. Call from a tap. */
  async function open({ target = null } = {}) {
    close();
    const s = (state = { places: [], heading: null, position: null, target: null, best: null, foundAt: null, popped: new Set() });
    // iPhone asks for the compass separately, and only during a tap: ask first, before any wait.
    const compassAsk = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission().catch(() => 'denied')
      : Promise.resolve('granted');
    $('lens').hidden = false;
    document.body.classList.add('lens-open');
    $('lens-popup').hidden = true;
    $('lens-card').hidden = true;
    $('lens-street').hidden = true;
    $('lens-labels').replaceChildren();
    setTarget(target);
    status('Starting the camera…');

    s.onOrient = (e) => {
      const h = cameraHeading(e);
      if (h == null || s.closed) return;
      if (s.heading == null) clearTimeout(s.compassTimer);
      s.heading = smoothHeading(s.heading, h);
      s.compass = true;
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
    if (first || distanceMeters(s.fetchedAt, position) > REFETCH_AFTER_M) {
      s.fetchedAt = position;
      status(s.target ? `Looking for ${s.target.name}…` : 'Looking for landmarks around you…');
      wiki
        .nearby(position.lat, position.lon, 400, 50)
        .then((places) => {
          if (s.closed) return;
          s.places = places;
          if (!places.length) status('No landmarks known within 400 m. Try walking a little further.');
          draw();
        })
        .catch(() => !s.closed && status("Wikipedia didn't answer just now. I'll try again as you move.", 'warn'));
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
    const inView = compass ? placesInView(s.position, s.heading, s.places) : placesAround(s.position, s.places);
    if (s.places.length && !s.target) status(compass ? '' : "No compass on this phone: here's what's around you, nearest first.");

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
            style: compass ? `left:${(p.x * 100).toFixed(1)}%; top:${top + Math.min(4, i) * 8}%` : `left:50%; top:${top + i * 8}%`,
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
    box.hidden = false;
    box.dataset.name = name;
    const text = summary?.extract ? firstSentences(summary.extract, 5) : summary === null ? 'Looking it up…' : '';
    box.replaceChildren(
      ...(summary?.thumbnail ? [el('img', { src: summary.thumbnail, alt: '', className: 'lens-popup-img' })] : []),
      el('h3', { textContent: summary?.title ?? name }),
      ...(summary?.description ? [el('p', { className: 'lens-popup-desc', textContent: summary.description })] : []),
      el('p', { className: 'lens-popup-text', id: 'lens-text', textContent: text || "Wikipedia has nothing about this place yet." }),
      el('div', { className: 'lens-popup-actions' }, [
        ...(summary?.extract
          ? [el('button', { type: 'button', className: 'btn-primary btn-small', textContent: 'Hear its story', onclick: () => tell(summary) })]
          : []),
        ...(summary?.url ? [el('a', { className: 'btn-soft btn-small', href: summary.url, target: '_blank', rel: 'noopener', textContent: 'Read more ↗' })] : []),
        el('button', { type: 'button', className: 'text-btn', textContent: 'Close', onclick: () => (box.hidden = true) }),
      ]),
    );
  }

  function tell(summary) {
    const voice = narrator();
    voice.unlock?.(); // inside the tap, so phones allow the sound
    voice.speak(`${summary.title}. ${firstSentences(summary.extract, 6)}`, { kind: 'poi', title: summary.title, thumbnail: summary.thumbnail, url: summary.url }, { priority: true, interrupt: true });
  }

  return { open, close, setTarget, get isOpen() { return Boolean(state); } };
}

const sameName = (p, t) => (p.title ?? p.name) === (t.title ?? t.name) || (p.title ?? '').startsWith(t.name);
const roundMeters = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
