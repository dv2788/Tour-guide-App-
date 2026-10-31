// Which voice reads the tour. Two kinds:
//  - "soothing" AI voices (Piper neural TTS, run on the phone, downloaded once), chosen for
//    a calm delivery: moderate pitch, steady intonation, unhurried pace, soft high end.
//    See docs/voices.md for how they were compared, and each voice's dataset licence.
//    (The Jenny dataset asks that the voice be credited as "Jenny (Dioco)" in apps.)
//  - the phone's built-in voices, ranked so the calmest natural-sounding one comes first.

// profile 'calm': soothing delivery. profile 'documentary': a deep, unhurried narrator in the
// style of classic nature documentaries (an original voice, not an imitation of anyone).
export const NEURAL_VOICES = {
  en: [
    { id: 'en_GB-jenny_dioco-medium', label: 'Jenny (Dioco)', note: 'Calm and gentle · British', profile: 'calm' },
    { id: 'en_US-amy-medium', label: 'Amy', note: 'Warm and soft · American', profile: 'calm' },
    { id: 'en_GB-vctk-medium', speaker: 10, label: 'Arthur', note: 'Documentary narrator · deep British voice', profile: 'documentary' },
  ],
  fr: [
    { id: 'fr_FR-siwis-medium', label: 'Siwis', note: 'Douce et claire', profile: 'calm' },
    { id: 'fr_FR-upmc-medium', speaker: 0, label: 'Jessica', note: 'Chaleureuse', profile: 'calm' },
    { id: 'fr_FR-upmc-medium', speaker: 1, label: 'Pierre', note: 'Narrateur de documentaire · voix grave', profile: 'documentary' },
  ],
  es: [
    { id: 'es_MX-claude-high', label: 'Claude', note: 'Pausada y cálida · México', profile: 'calm' },
    { id: 'es_ES-sharvard-medium', speaker: 1, label: 'Sharvard', note: 'Cálida · España', profile: 'calm' },
    { id: 'es_ES-sharvard-medium', speaker: 0, label: 'Marcos', note: 'Narrador de documental · voz grave', profile: 'documentary' },
  ],
  de: [
    { id: 'de_DE-kerstin-low', label: 'Kerstin', note: 'Ruhig und gleichmäßig', profile: 'calm' },
    // Already a deep voice: lowering it further blurs German consonants.
    { id: 'de_DE-thorsten-medium', label: 'Thorsten', note: 'Dokumentarfilm-Erzähler · tiefe Stimme', profile: 'documentary', tweak: { pitch: 1 } },
  ],
  it: [
    { id: 'it_IT-paola-medium', label: 'Paola', note: 'Calma e regolare', profile: 'calm' },
    { id: 'it_IT-serena-medium', label: 'Serena', note: 'Limpida', profile: 'calm' },
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

/** Voice ids are stored as "neural:<piper id>:<speaker>" or "system:<voice name>". */
export function neuralVoiceKey(v) {
  return `neural:${v.id}:${v.speaker ?? 0}`;
}

export function parseVoiceKey(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('neural:')) {
    const [, id, speaker] = key.split(':');
    return { kind: 'neural', id, speaker: Number(speaker) || 0 };
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
  en: "And here, on your left… the Pont Alexandre the Third. Built for the great Exhibition of 1900, it is, quite simply, the most beautiful bridge in Paris.",
  fr: "Et ici, sur votre gauche… le pont Alexandre-III. Construit pour l'Exposition universelle de 1900, il est, tout simplement, le plus beau pont de Paris.",
  es: 'Y aquí, a nuestra izquierda… el puente de Alejandro III. Construido para la gran Exposición de 1900, es, sencillamente, el puente más bello de París.',
  de: 'Und hier, zu unserer Linken… die Pont Alexandre III. Erbaut für die große Weltausstellung von 1900, ist sie schlicht die schönste Brücke von Paris.',
};

export const PREVIEW_TEXT = {
  en: "Hello, I'll be your guide today. On your left: the Pont Alexandre the Third, often called the most beautiful bridge in Paris.",
  fr: "Bonjour, je serai votre guide aujourd'hui. Sur votre gauche : le pont Alexandre-III, souvent considéré comme le plus beau pont de Paris.",
  es: 'Hola, hoy seré tu guía. A tu izquierda: el puente de Alejandro III, a menudo considerado el puente más bello de París.',
  de: 'Hallo, ich bin heute Ihr Reiseführer. Zu Ihrer Linken: die Pont Alexandre III, oft als die schönste Brücke von Paris bezeichnet.',
  it: 'Ciao, oggi sarò la tua guida. Alla tua sinistra: il ponte Alessandro III, spesso considerato il ponte più bello di Parigi.',
};
