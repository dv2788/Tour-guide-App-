// The brain of the guide: given where you are and which way you're heading,
// decide what to say next. No DOM access; the narrator and Wikipedia are injected.

import { distanceMeters, distanceToSegmentMeters, bearingDegrees, relativeDirection } from './geo.js';
import {
  buildPoiNarration,
  buildWelcomeNarration,
  buildFirstStopNarration,
  buildArrivalNarration,
  placeName,
  LINGER_MINUTES,
} from './narration.js';

const HEADING_MIN_MOVE_M = 10; // ignore GPS jitter when working out direction of travel
const MIN_REFETCH_MS = 8000;
const MAX_TRUSTED_JUMP_M = 2000; // a bigger jump between fixes is a GPS glitch, not travel
const MINOR_AFTER_MS = 45000; // streets, stations…: only worth it after a long silence
// Wikipedia can be slow or busy: the welcome and each arrival wait this long for their article,
// then speak without it rather than keep you waiting.
const WELCOME_WAIT_MS = 4000;
const ARRIVAL_WAIT_MS = 8000;
const ARRIVAL_HYSTERESIS_M = 25; // GPS wobble at the edge of a stop's radius isn't "coming to it"
const LEAD_WAIT_MS = 2500; // the whole lead section of an article: nice to have, not worth a long silence
const atMost = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * How close counts as "arrived". Big places (the Louvre, a park) count from their edge,
 * not their centre point, using the outline OpenStreetMap gives us.
 */
export function arrivalRadiusFor(stop, mode) {
  if (!stop.isArea || !stop.bbox) return mode.arrivalRadius;
  const [south, north, west, east] = stop.bbox;
  const halfDiagonal = distanceMeters({ lat: south, lon: west }, { lat: north, lon: east }) / 2;
  return Math.round(Math.min(Math.max(mode.arrivalRadius, halfDiagonal * 0.8), mode.arrivalRadius + 200));
}

/**
 * Pick the best place to talk about right now, or null.
 * Closer is better, places with a photo tend to be notable, things behind you are
 * deprioritised (and skipped entirely when driving: you've already passed them).
 */
export function pickNextPoi({ pois, position, heading, narrated, mode, allowMinor = false }) {
  let best = null;
  for (const poi of pois) {
    if (narrated.has(poi.id) || poi.category === 'skip') continue;
    if (poi.category === 'minor' && !allowMinor) continue;
    const distance = distanceMeters(position, poi);
    if (distance > mode.triggerRadius) continue;
    const direction = relativeDirection(heading, bearingDegrees(position, poi));
    if (mode.id === 'drive' && direction === 'behind') continue;
    let score = distance / mode.triggerRadius;
    if (direction === 'behind') score += 0.5;
    if (poi.category === 'minor') score += 0.6;
    if (poi.thumbnail) score -= 0.25;
    if (!best || score < best.score) best = { poi, distance, direction, score };
  }
  return best;
}

export class TourEngine {
  constructor({ mode, lang, wiki, narrator, city = null, stops = [], style = 'standard', happening = null, onEvent = () => {}, now = () => Date.now() }) {
    this.happening = happening; // an event on in the city, mentioned in the welcome
    this.mode = mode;
    this.lang = lang;
    this.style = style; // how the guide phrases things ('documentary' for narrator voices)
    this.wiki = wiki;
    this.narrator = narrator;
    this.city = city;
    this.stops = stops.map((s, index) => ({ ...s, index, reached: false, arrivalRadius: arrivalRadiusFor(s, mode) }));
    this.emit = onEvent;
    this.now = now;

    this.pois = new Map(); // id -> poi
    this.narrated = new Set(); // article ids already talked about
    this.position = null;
    this.heading = null;
    this.headingAnchor = null;
    this.nextStopIndex = 0;
    this.ready = false; // welcome queued
    this.running = false;
    this.announcedFirstStop = false;
    this.pendingPoi = false;
    this.pendingArrivals = 0;
    this.lastIdleAt = 0;
    this.fetching = false;
    this.lastFetch = null; // { position, at, coverage }
    this.quietAt = null; // a museum visit, a meal or a long stay: no stories until the traveller leaves
    this.retickTimer = null;
    this.readyPromise = new Promise((resolve) => (this.resolveReady = resolve));

    this.unsubscribe = narrator.on?.('idle', () => {
      this.lastIdleAt = this.now();
      this.tick();
    });
  }

  async start() {
    this.running = true;
    this.#prefetchStopArticles();
    let citySummary = null;
    if (this.city) {
      citySummary = await atMost(this.wiki.resolveArticle(this.city, { maxDistance: 30000 }).catch(() => null), WELCOME_WAIT_MS);
      if (citySummary) this.narrated.add(citySummary.pageid);
    }
    // The city's whole lead section (its story, not just its first paragraph), if it comes quickly.
    const lead = citySummary?.title && this.wiki.story ? await atMost(this.wiki.story(citySummary.title).catch(() => null), LEAD_WAIT_MS) : null;
    if (!this.running) return;
    const text = buildWelcomeNarration({
      lang: this.lang,
      style: this.style,
      cityName: this.city?.name,
      citySummary,
      lead,
      hasStops: this.stops.length > 0,
      happening: this.happening,
    });
    // The tour opens with the welcome: an arrival at the first stop (you often start right
    // there) or a direction already being spoken must not push it back.
    this.#say(
      text,
      {
        kind: 'city',
        title: this.city?.name ?? 'Tour started',
        thumbnail: citySummary?.thumbnail ?? null,
        url: citySummary?.url ?? null,
      },
      { priority: true },
    );
    this.ready = true;
    this.resolveReady();
    this.tick();
  }

  /**
   * The route can only get within `meters` of this stop (it stands in a garden, behind a
   * building…): count arriving from that close, or you'd walk past it without noticing.
   */
  approachLimit(index, meters) {
    const stop = this.stops[index];
    if (!stop || !Number.isFinite(meters)) return;
    stop.arrivalRadius = Math.max(stop.arrivalRadius, Math.min(Math.round(meters) + 25, this.mode.arrivalRadius + 250));
  }

  stop() {
    this.running = false;
    clearTimeout(this.retickTimer);
    this.unsubscribe?.();
  }

  /** Feed a new position: {lat, lon, heading?, speed?, accuracy?}. */
  update(pos) {
    if (!this.running) return;
    if (Number.isFinite(pos.heading) && (pos.speed == null || pos.speed > 0.7)) {
      this.heading = pos.heading;
      this.headingAnchor = pos;
    } else if (!this.headingAnchor) {
      this.headingAnchor = pos;
    } else if (distanceMeters(this.headingAnchor, pos) >= HEADING_MIN_MOVE_M) {
      this.heading = bearingDegrees(this.headingAnchor, pos);
      this.headingAnchor = pos;
    }
    const previous = this.position;
    this.position = { lat: pos.lat, lon: pos.lon };
    this.emit('position', { ...this.position, heading: this.heading, accuracy: pos.accuracy });
    this.#checkArrivals(previous, this.position);
    this.#maybeFetchPois();
    this.tick();
  }

  /**
   * Did we reach (or pass) any remaining stops since the last position? Checked along
   * the whole path travelled, so fast travel or sparse GPS fixes can't skip a stop.
   * Stops can be reached out of order; earlier ones are then considered skipped.
   */
  #checkArrivals(previous, current) {
    const usePath = previous && distanceMeters(previous, current) <= MAX_TRUSTED_JUMP_M;
    const closest = (stop) =>
      usePath ? distanceToSegmentMeters(stop, previous, current) : distanceMeters(current, stop);
    // A later stop is reached only when you come to it: standing next to it at the start (a round
    // trip begins and ends by the same place) or lingering nearby doesn't skip the stops before it.
    const cameTo = (stop) => !!previous && distanceMeters(previous, stop) > stop.arrivalRadius + ARRIVAL_HYSTERESIS_M;
    const reached = this.stops
      .slice(this.nextStopIndex)
      .filter((stop) => closest(stop) <= stop.arrivalRadius && (stop.index === this.nextStopIndex || cameTo(stop)));
    for (const stop of reached) this.#arrive(stop);
  }

  /** Decide whether to say something now. Safe to call often. */
  tick() {
    if (!this.running || !this.position) return;
    const pos = this.position;

    // 1. Itinerary stops (arrivals themselves are detected in update()). Directions to the next
    // stop start at once: they don't wait for the welcome, or for Wikipedia.
    const next = this.stops[this.nextStopIndex];
    const distanceToNext = next ? distanceMeters(pos, next) : Infinity;
    if (next) this.emit('next-stop', { stop: next, distance: distanceToNext });
    if (!this.ready) return;
    if (next) {
      if (!this.announcedFirstStop && this.nextStopIndex === 0) {
        this.announcedFirstStop = true;
        this.#say(buildFirstStopNarration({ lang: this.lang, style: this.style, stopName: this.#spokenName(next), distance: distanceToNext }), {
          kind: 'info',
          title: next.name,
        });
        return;
      }
    }

    // 2. Otherwise, talk about interesting places you're passing.
    if (this.narrator.busy || this.pendingPoi || this.pendingArrivals > 0) return;
    const approaching = next && distanceToNext <= next.arrivalRadius + this.mode.arrivalRadius * 1.5;
    if (approaching) this.#primeArrival(next);
    if (this.quietAt) {
      // Visiting a museum or having a meal: stay quiet until they set off again.
      if (distanceMeters(pos, this.quietAt) <= this.quietAt.arrivalRadius + 120) return;
      this.quietAt = null;
    }
    if (approaching) return; // about to arrive: no new story now
    const quietFor = this.now() - this.lastIdleAt;
    const gapMs = this.mode.gapSeconds * 1000;
    if (quietFor < gapMs) {
      clearTimeout(this.retickTimer);
      this.retickTimer = setTimeout(() => this.tick(), gapMs - quietFor + 50);
      return;
    }
    const pick = pickNextPoi({
      pois: this.pois.values(),
      position: pos,
      heading: this.heading,
      narrated: this.narrated,
      mode: this.mode,
      allowMinor: quietFor >= MINOR_AFTER_MS,
    });
    if (pick) this.#narratePoi(pick.poi);
  }

  async #narratePoi(poi) {
    this.pendingPoi = true;
    this.narrated.add(poi.id);
    try {
      const summary = await this.wiki.summary(poi.title).catch(() => null);
      if (!this.running) return;
      if (summary?.pageid && summary.pageid !== poi.id && this.narrated.has(summary.pageid)) return; // told already, under another title
      if (summary?.pageid) this.narrated.add(summary.pageid);
      // Recompute direction now: we may have moved while the story was loading.
      const distance = distanceMeters(this.position, poi);
      const direction = relativeDirection(this.heading, bearingDegrees(this.position, poi));
      const text = buildPoiNarration({
        lang: this.lang,
        style: this.style,
        mode: this.mode,
        title: poi.title,
        summary: summary ?? { description: poi.description },
        direction,
        distance,
      });
      this.emit('narrated', { poi });
      this.#say(text, {
        kind: 'poi',
        id: poi.id,
        title: poi.title,
        thumbnail: summary?.thumbnail ?? poi.thumbnail,
        url: summary?.url ?? null,
      });
    } finally {
      this.pendingPoi = false;
    }
  }

  async #arrive(stop) {
    // Mark synchronously so the next position update doesn't trigger it again.
    // Stops before it that were never reached stay unreached (skipped).
    stop.reached = true;
    this.nextStopIndex = stop.index + 1;
    if (stop.kind === 'food' || stop.visitMinutes || stop.stayMinutes >= LINGER_MINUTES) this.quietAt = stop;
    this.announcedFirstStop = true;
    this.pendingArrivals++;
    this.emit('stop-reached', { stop });
    try {
      const [summary] = await Promise.all([atMost(this.#stopArticle(stop), ARRIVAL_WAIT_MS), this.readyPromise]); // after the welcome
      if (!this.running) return;
      // The line was usually composed (and its first words synthesized) on the way here.
      let text = stop.arrivalText;
      if (!text) {
        const lead = stop.storyPromise ? await atMost(stop.storyPromise, LEAD_WAIT_MS) : null;
        if (!this.running) return;
        text = this.#arrivalNarration(stop, summary, lead);
      }
      const interrupt = this.narrator.current?.meta?.kind === 'poi';
      this.#say(
        text,
        { kind: 'stop', title: stop.name, thumbnail: summary?.thumbnail ?? null, url: summary?.url ?? null },
        { priority: true, interrupt },
      );
    } finally {
      this.pendingArrivals--;
    }
  }

  #arrivalNarration(stop, summary, lead) {
    const following = this.stops[stop.index + 1] ?? null;
    return buildArrivalNarration({
      lang: this.lang,
      style: this.style,
      mode: this.mode,
      stopName: stop.name,
      summary,
      lead,
      city: this.city?.name ?? '',
      nextStopName: following ? this.#spokenName(following) : null,
      nextDistance: following ? distanceMeters(stop, following) : 0,
      kind: stop.kind,
      meal: stop.meal,
      visitMinutes: stop.visitMinutes,
      stayMinutes: stop.stayMinutes,
    });
  }

  /**
   * Approaching a stop, with nothing being said: compose its arrival line now and let the voice
   * get its first sentences ready, so the guide speaks the moment you arrive. Needs the stop's
   * article and lead, and the next stop's article (its name is said the way that article does).
   */
  #primeArrival(stop) {
    if (stop.arrivalText || stop.summary === undefined) return;
    if (stop.storyPromise && stop.lead === undefined) return;
    const following = this.stops[stop.index + 1];
    if (following && following.summary === undefined && following.kind !== 'food') return;
    stop.arrivalText = this.#arrivalNarration(stop, stop.summary, stop.lead ?? null);
    this.narrator.prime?.(stop.arrivalText);
  }

  #stopArticle(stop) {
    // Cafés and restaurants only get a story when they're notable (tagged with an article).
    if (stop.kind === 'food' && !stop.wikipedia && !stop.wikidata) {
      stop.summary ??= null; // known: nothing to tell (so the break's line can be primed too)
      return Promise.resolve(null);
    }
    if (!stop.articlePromise) {
      stop.articlePromise = this.wiki
        .resolveArticle({ ...stop, city: this.city?.name ?? '' })
        .catch(() => null)
        .then((s) => {
          if (s?.pageid) this.narrated.add(s.pageid); // don't also mention it as a passing place
          stop.summary = s;
          if (s?.title && this.wiki.story) {
            stop.storyPromise = this.wiki
              .story(s.title)
              .catch(() => null)
              .then((lead) => (stop.lead = lead ?? null));
          }
          return s;
        });
    }
    return stop.articlePromise;
  }

  /** A stop's name as this language says it (once its article is known; the given name until then). */
  #spokenName(stop) {
    return placeName(stop.name, stop.summary ?? null, this.lang, { city: this.city?.name ?? '' });
  }

  async #prefetchStopArticles() {
    for (const stop of this.stops) {
      if (!this.running) return;
      await this.#stopArticle(stop);
    }
  }

  async #maybeFetchPois() {
    if (this.fetching) return;
    const pos = this.position;
    const last = this.lastFetch;
    if (last?.failed) {
      if (this.now() - last.at < MIN_REFETCH_MS) return;
    } else if (last) {
      const moved = distanceMeters(last.position, pos);
      // Refetch once we've used up a good part of the area we know about.
      if (moved < Math.max(100, last.coverage * 0.5)) return;
      if (this.now() - last.at < MIN_REFETCH_MS) return;
    }
    this.fetching = true;
    const limit = 50;
    try {
      const found = await this.wiki.nearby(pos.lat, pos.lon, this.mode.searchRadius, limit);
      // If the result list was full, we only know about a smaller circle than we asked for.
      const coverage =
        found.length >= limit
          ? Math.max(...found.map((p) => distanceMeters(pos, p)))
          : this.mode.searchRadius;
      this.lastFetch = { position: pos, at: this.now(), coverage };
      const added = [];
      for (const poi of found) {
        if (!this.pois.has(poi.id)) {
          this.pois.set(poi.id, poi);
          added.push(poi);
        }
      }
      if (added.length) this.emit('pois', { added });
    } catch (error) {
      this.lastFetch = { position: pos, at: this.now(), failed: true }; // retry after MIN_REFETCH_MS
      this.emit('error', { message: 'Could not load nearby places. Retrying shortly.', error });
    } finally {
      this.fetching = false;
    }
    this.tick();
  }

  #say(text, meta, options = {}) {
    this.narrator.speak(text, meta, options);
  }
}
