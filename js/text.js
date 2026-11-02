// Turning encyclopedia text into something pleasant to listen to.

/**
 * Remove things that sound terrible when read aloud: parenthetical asides
 * (pronunciations, IPA, alternative names), [citation] brackets, stray spacing.
 */
export function cleanForSpeech(text) {
  if (!text) return '';
  // Whitespace runs first: every step below then works in a single pass, whatever the text
  // (Wikipedia text is written by anyone: a run of 100,000 spaces must not freeze the phone).
  let s = String(text).replace(/\s{2,}/g, ' ');
  s = dropAsides(s);
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

/**
 * Remove "(…)" and "[…]" asides, nested or not, with the space before each; a bracket that is
 * never closed stays. One pass over the text, however deep the nesting.
 */
function dropAsides(s) {
  const marks = new Int32Array(s.length + 1); // +1 where a removed stretch starts, -1 after it ends
  const open = { '(': [], '[': [] };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') open[c].push(i);
    else if ((c === ')' && open['('].length) || (c === ']' && open['['].length)) {
      let start = open[c === ')' ? '(' : '['].pop();
      if (start > 0 && /\s/.test(s[start - 1])) start--;
      marks[start]++;
      marks[i + 1]--;
    }
  }
  const kept = [];
  let inside = 0;
  for (let i = 0; i < s.length; i++) {
    inside += marks[i];
    if (inside === 0) kept.push(s[i]);
  }
  return kept.join('');
}

/** Split text into sentences, using the platform's sentence segmenter when available. */
export function splitSentences(text, lang = 'en') {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
    return Array.from(seg.segment(text), (s) => s.segment.trim()).filter(Boolean);
  }
  // Older browsers: cut after . ! or ? followed by a space or the end (one pass, no regex backtracking).
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ('.!?'.includes(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1])) && !'.!?'.includes(text[i + 1] ?? '')) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
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
export function classifyPlace({ title: rawTitle = '', description: rawDescription = '', disambiguation = false } = {}) {
  // Wikipedia titles are at most 255 bytes and short descriptions a line: longer is vandalism,
  // and only the start is needed to tell what a place is.
  const title = String(rawTitle ?? '').slice(0, 300);
  const description = String(rawDescription ?? '').slice(0, 500);
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
