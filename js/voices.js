// Which voice reads the tour. Two kinds:
//  - AI voices that run on the phone (downloaded once): Supertonic 3, one natural voice model
//    that speaks all five languages (js/supertonicVoice.js), and the lighter Piper voices
//    (js/neuralVoice.js). Chosen for a calm delivery: moderate pitch, steady intonation,
//    unhurried pace, soft high end. See docs/voices.md for how they were compared, and each
//    voice's licence. (The Jenny dataset asks that the voice be credited as "Jenny (Dioco)".)
//  - the phone's built-in voices, ranked so the calmest natural-sounding one comes first.

// profile 'calm': soothing delivery. profile 'documentary': a deep, unhurried narrator in the
// style of classic nature documentaries (an original voice, not an imitation of anyone).
// Supertonic's voice styles (the same voice in every language): F1 calm and composed,
// slightly low; M2 deep, calm and serious; F5 kind, soft-spoken and soothing.
const supertonic = ([calm, narrator, soft]) => [
  { id: 'supertonic-3', style: 'F1', label: 'Nora', note: calm, profile: 'calm' },
  { id: 'supertonic-3', style: 'M2', label: 'Victor', note: narrator, profile: 'documentary' },
  { id: 'supertonic-3', style: 'F5', label: 'Lea', note: soft, profile: 'calm' },
];
export const NEURAL_VOICES = {
  en: [
    ...supertonic(['Natural and calm · the new voice', 'Documentary narrator · deep and composed', 'Soft-spoken and gentle']),
    { id: 'en_GB-jenny_dioco-medium', label: 'Jenny (Dioco)', note: 'Lighter voice (smaller download) · British', profile: 'calm' },
  ],
  fr: [
    ...supertonic(['Naturelle et posée · la nouvelle voix', 'Narrateur de documentaire · grave et posé', 'Douce et chaleureuse']),
    { id: 'fr_FR-siwis-medium', label: 'Siwis', note: 'Voix légère (téléchargement plus petit)', profile: 'calm' },
  ],
  es: [
    ...supertonic(['Natural y serena · la nueva voz', 'Narrador de documental · grave y sereno', 'Suave y cálida']),
    { id: 'es_MX-claude-high', label: 'Claude', note: 'Voz ligera (descarga más pequeña) · México', profile: 'calm' },
  ],
  de: [
    ...supertonic(['Natürlich und ruhig · die neue Stimme', 'Dokumentarfilm-Erzähler · tief und ruhig', 'Sanft und warm']),
    { id: 'de_DE-kerstin-low', label: 'Kerstin', note: 'Leichte Stimme (kleinerer Download)', profile: 'calm' },
  ],
  it: [
    ...supertonic(['Naturale e calma · la nuova voce', 'Narratore di documentari · profondo e pacato', 'Dolce e calda']),
    { id: 'it_IT-paola-medium', label: 'Paola', note: 'Voce leggera (download più piccolo)', profile: 'calm' },
  ],
};

/**
 * How each kind of voice delivers the tour.
 * pace: slower than the model's default (>1). pitch: playback rate, <1 = deeper (and the
 * synthesis pace is adjusted so the overall speed stays as set). pause: seconds between
 * sentences. eq: dB of low "body" and high "air" (negative = softer).
 */
export const VOICE_PROFILES = {
  calm: { pace: 1.12, pitch: 1, pause: 0.28, style: 'standard', eq: { low: 2, high: -4 } },
  documentary: { pace: 1.2, pitch: 0.93, pause: 0.6, style: 'documentary', eq: { low: 3.5, high: -5.5 } },
};

/** A voice's delivery: its profile, with any per-voice adjustments. */
export function voiceProfile(name, tweak = {}) {
  return { ...(VOICE_PROFILES[name] ?? VOICE_PROFILES.calm), ...tweak };
}

/**
 * Voice ids are stored as "neural:<model id>:<speaker number or style name>" (e.g.
 * "neural:supertonic-3:F1", "neural:en_GB-vctk-medium:10") or "system:<voice name>".
 */
export function neuralVoiceKey(v) {
  return `neural:${v.id}:${v.style ?? v.speaker ?? 0}`;
}

export function parseVoiceKey(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('neural:')) {
    const [, id, variant = '0'] = key.split(':');
    return /^\d+$/.test(variant) ? { kind: 'neural', id, speaker: Number(variant) } : { kind: 'neural', id, speaker: 0, style: variant };
  }
  if (key.startsWith('system:')) return { kind: 'system', name: key.slice(7) };
  return null;
}

export function defaultVoiceKey(lang) {
  const first = NEURAL_VOICES[lang]?.[0] ?? NEURAL_VOICES.en[0];
  return neuralVoiceKey(first);
}

// Built-in voices known to sound natural and calm on iPhone/Mac (Apple), Windows/Edge
// (Microsoft "Natural"), and Android/Chrome (Google).
const CALM_NAMES = {
  en: ['Ava', 'Zoe', 'Allison', 'Samantha', 'Susan', 'Serena', 'Kate', 'Moira', 'Tessa', 'Karen', 'Emma', 'Jenny', 'Aria', 'Sonia', 'Libby', 'Natasha', 'Clara'],
  fr: ['Amélie', 'Audrey', 'Aurélie', 'Marie', 'Denise', 'Vivienne', 'Eloise', 'Sylvie'],
  es: ['Mónica', 'Monica', 'Paulina', 'Marisol', 'Soledad', 'Elvira', 'Ximena', 'Dalia'],
  de: ['Anna', 'Petra', 'Helena', 'Katja', 'Seraphina', 'Amala'],
  it: ['Alice', 'Federica', 'Paola', 'Elsa', 'Isabella'],
};
// Novelty and robotic voices bundled with Apple devices: never pick these automatically.
const ROBOTIC = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Rocko|Shelley|Sandy|Flo|Eddy|Reed|Deranged|Hysterical)\b/i;

/** Score a built-in voice for calm, natural narration (higher is better). */
export function systemVoiceScore(voice, lang, locale) {
  const vLang = (voice.lang ?? '').toLowerCase().replace('_', '-');
  if (!vLang.startsWith(lang)) return -Infinity;
  let score = 0;
  if (vLang === locale.toLowerCase()) score += 2;
  if (/premium|enhanced|natural|neural|wavenet/i.test(voice.name)) score += 5;
  if ((CALM_NAMES[lang] ?? []).some((n) => new RegExp(`\\b${n}\\b`, 'i').test(voice.name))) score += 3;
  if (/google/i.test(voice.name)) score += 1;
  if (voice.localService) score += 0.5; // works without data
  if (ROBOTIC.test(voice.name)) score -= 10;
  return score;
}

/** Built-in voices for a language, calmest first. */
export function rankSystemVoices(voices, lang, locale) {
  return voices
    .map((v) => ({ v, s: systemVoiceScore(v, lang, locale) }))
    .filter(({ s }) => s > -Infinity)
    .sort((a, b) => b.s - a.s)
    .map(({ v }) => v);
}

// A capitalised name, then a space or hyphen ("Louis XIV", "pont Alexandre-III"), then a numeral.
const ROMAN = /([A-ZÀ-ÖØ-Þ][\p{L}'’]+)(?:\s+|-)(M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))(?=[\s.,;:!?)]|$)/gu;
const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanToNumber(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VALUES[s[i]];
    total += v < (ROMAN_VALUES[s[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

/**
 * Small fixes so the AI voice reads naturally. French and German voices read regnal
 * numbers literally ("Louis XIV" -> "Louis X I V romain"); digits come out right
 * ("Louis quatorze", "Ludwig vierzehnte").
 */
export function prepareForNeuralVoice(text, lang) {
  if (lang !== 'fr' && lang !== 'de') return text;
  return text.replace(ROMAN, (match, name, numeral) =>
    numeral.length >= 2 ? `${name} ${romanToNumber(numeral)}` : match,
  );
}

export const PREVIEW_TEXT_DOCUMENTARY = {
  en: 'And here, on your left… Casa Batlló. Rebuilt by Gaudí in 1904, its roof rises like the back of a sleeping dragon.',
  fr: "Et ici, sur votre gauche… la Casa Batlló. Transformée par Gaudí en 1904, son toit s'élève comme le dos d'un dragon endormi.",
  es: 'Y aquí, a nuestra izquierda… la Casa Batlló. Transformada por Gaudí en 1904, su tejado se alza como el lomo de un dragón dormido.',
  de: 'Und hier, zu unserer Linken… die Casa Batlló. Von Gaudí 1904 umgestaltet, erhebt sich ihr Dach wie der Rücken eines schlafenden Drachen.',
};

export const PREVIEW_TEXT = {
  en: "Hello, I'll be your guide today. On your left: Casa Batlló, the house Gaudí rebuilt in 1904, with balconies like masks and a roof like a dragon's back.",
  fr: "Bonjour, je serai votre guide aujourd'hui. Sur votre gauche : la Casa Batlló, que Gaudí a transformée en 1904, avec des balcons comme des masques et un toit comme le dos d'un dragon.",
  es: 'Hola, hoy seré tu guía. A tu izquierda: la Casa Batlló, que Gaudí transformó en 1904, con balcones como máscaras y un tejado como el lomo de un dragón.',
  de: 'Hallo, ich bin heute Ihr Reiseführer. Zu Ihrer Linken: die Casa Batlló, die Gaudí 1904 umgestaltet hat, mit Balkonen wie Masken und einem Dach wie dem Rücken eines Drachen.',
  it: 'Ciao, oggi sarò la tua guida. Alla tua sinistra: Casa Batlló, che Gaudí trasformò nel 1904, con balconi come maschere e un tetto come il dorso di un drago.',
};
