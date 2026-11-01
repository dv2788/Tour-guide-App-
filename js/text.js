// Turning encyclopedia text into something pleasant to listen to.

/**
 * Remove things that sound terrible when read aloud: parenthetical asides
 * (pronunciations, IPA, alternative names), [citation] brackets, stray spacing.
 */
export function cleanForSpeech(text) {
  if (!text) return '';
  let s = String(text);
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*\([^()]*\)/g, '');
  } while (s !== prev);
  s = s.replace(/\s*\[[^[\]]*\]/g, '');
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

/** Split text into sentences, using the platform's sentence segmenter when available. */
export function splitSentences(text, lang = 'en') {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
    return Array.from(seg.segment(text), (s) => s.segment.trim()).filter(Boolean);
  }
  return (text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** The first `count` sentences of a text. */
export function firstSentences(text, count, lang = 'en') {
  return splitSentences(text, lang).slice(0, Math.max(0, count)).join(' ');
}

/**
 * Break text into chunks short enough for speech engines (some browsers silently
 * stop speaking utterances longer than ~15 seconds).
 */
export function chunkForSpeech(text, maxLen = 220, lang = 'en') {
  const chunks = [];
  let current = '';
  const pushPiece = (piece) => {
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= maxLen) current += ' ' + piece;
    else {
      chunks.push(current);
      current = piece;
    }
  };
  for (const sentence of splitSentences(text, lang)) {
    if (sentence.length <= maxLen) {
      pushPiece(sentence);
      continue;
    }
    // A very long sentence: split on commas/semicolons, then on spaces if needed.
    for (const part of sentence.split(/(?<=[,;:])\s+/)) {
      if (part.length <= maxLen) {
        pushPiece(part);
        continue;
      }
      let rest = part;
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(' ', maxLen);
        if (cut <= 0) cut = maxLen;
        pushPiece(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) pushPiece(rest);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Places that are almost never worth interrupting someone's trip for.
const SKIP_RE =
  /\b(m[ée]tro station|subway station|underground station|tram stop|bus stop|bus station|station de m[ée]tro|arr[êe]t de bus|estaci[óo]n de metro|parada de autob[úu]s|u-bahnhof|haltestelle|stazione della metropolitana|fermata|wikimedia|electoral (district|ward)|constituency)\b/i;

// "Venezia (Rome Metro)", "Opéra (Paris Métro)", "Sol (Madrid Metro)".
const METRO_TITLE_RE = /\((?:[^)]*\s)?(?:m[ée]tro|metro station|subway|underground|u-bahn|metropolitana)\)$/i;

// Places that can be interesting but usually aren't: mention only if nothing better is around.
const MINOR_RE =
  /\b(street|road|lane|avenue|boulevard|highway|motorway|station|school|company|corporation|office building|hotel|restaurant|rue|calle|stra(ss|ß)e|via|gare|[ée]cole|escuela|schule|scuola)\b/i;

/** Classify a place as 'skip', 'minor', or null (interesting). */
export function classifyPlace({ title = '', description = '', disambiguation = false } = {}) {
  if (disambiguation || /^list of\b/i.test(title) || SKIP_RE.test(description) || METRO_TITLE_RE.test(title)) return 'skip';
  if (MINOR_RE.test(description) || /\b(station|gare|bahnhof)\b/i.test(title)) return 'minor';
  return null;
}

const STOPWORDS = new Set(['the', 'and', 'of', 'de', 'du', 'des', 'la', 'le', 'les', 'el', 'los', 'las', 'der', 'die', 'das', 'di', 'del', 'della', 'museum', 'musee', 'museo']);

/** Lowercase, accent-free significant words, for fuzzy name matching. */
export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function sharesNameToken(a, b) {
  const ta = new Set(nameTokens(a));
  return nameTokens(b).some((w) => ta.has(w));
}
