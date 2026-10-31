// Languages the guide can speak, and the short phrases it uses between stories.
// The stories themselves come from Wikipedia in the chosen language.

export const LANGUAGES = [
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'fr', label: 'Français', locale: 'fr-FR' },
  { code: 'es', label: 'Español', locale: 'es-ES' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
  { code: 'it', label: 'Italiano', locale: 'it-IT' },
];

const PHRASES = {
  en: {
    welcome: 'Welcome to {city}.',
    started: 'Your tour has started. Enjoy!',
    freeRoam: "No itinerary today, so I'll tell you about whatever you pass.",
    left: 'On your left',
    right: 'On your right',
    ahead: 'Ahead of you',
    behind: 'Just behind you',
    nearby: 'Nearby',
    inDistance: 'in {d}',
    poiIntro: '{dir}: {title}.',
    firstStop: 'Your first stop is {name}, {d} away.',
    arrived: 'You have arrived at {name}.',
    nextStop: 'Next stop: {name}, {d} away.',
    tourDone: "That was your last stop. Thanks for touring with me! I'll keep telling you about places you pass.",
    meters: '{n} meters',
    km: '{n} kilometers',
    kmOne: '1 kilometer',
  },
  fr: {
    welcome: 'Bienvenue à {city}.',
    started: 'Votre visite commence. Bonne balade !',
    freeRoam: "Pas d'itinéraire aujourd'hui : je vous parlerai de tout ce que vous croiserez.",
    left: 'Sur votre gauche',
    right: 'Sur votre droite',
    ahead: 'Devant vous',
    behind: 'Juste derrière vous',
    nearby: 'Tout près',
    inDistance: 'dans {d}',
    poiIntro: '{dir} : {title}.',
    firstStop: 'Votre premier arrêt est {name}, à {d}.',
    arrived: 'Vous voici à {name}.',
    nextStop: 'Prochain arrêt : {name}, à {d}.',
    tourDone: "C'était votre dernier arrêt. Merci d'avoir visité avec moi ! Je continue à vous parler des lieux que vous croisez.",
    meters: '{n} mètres',
    km: '{n} kilomètres',
    kmOne: '1 kilomètre',
  },
  es: {
    welcome: 'Bienvenido a {city}.',
    started: 'Tu recorrido ha comenzado. ¡Disfruta!',
    freeRoam: 'Hoy no hay itinerario, así que te contaré sobre todo lo que encuentres.',
    left: 'A tu izquierda',
    right: 'A tu derecha',
    ahead: 'Delante de ti',
    behind: 'Justo detrás de ti',
    nearby: 'Cerca',
    inDistance: 'a {d}',
    poiIntro: '{dir}: {title}.',
    firstStop: 'Tu primera parada es {name}, a {d}.',
    arrived: 'Has llegado a {name}.',
    nextStop: 'Próxima parada: {name}, a {d}.',
    tourDone: '¡Esa fue tu última parada! Gracias por recorrer la ciudad conmigo. Seguiré contándote sobre los lugares que pases.',
    meters: '{n} metros',
    km: '{n} kilómetros',
    kmOne: '1 kilómetro',
  },
  de: {
    welcome: 'Willkommen in {city}.',
    started: 'Ihre Tour hat begonnen. Viel Spaß!',
    freeRoam: 'Heute ohne Route – ich erzähle Ihnen von allem, woran Sie vorbeikommen.',
    left: 'Zu Ihrer Linken',
    right: 'Zu Ihrer Rechten',
    ahead: 'Vor Ihnen',
    behind: 'Direkt hinter Ihnen',
    nearby: 'In der Nähe',
    inDistance: 'in {d}',
    poiIntro: '{dir}: {title}.',
    firstStop: 'Ihr erster Halt ist {name}, {d} entfernt.',
    arrived: 'Sie sind bei {name} angekommen.',
    nextStop: 'Nächster Halt: {name}, {d} entfernt.',
    tourDone: 'Das war Ihr letzter Halt. Danke für die Tour! Ich erzähle Ihnen weiter von Orten, an denen Sie vorbeikommen.',
    meters: '{n} Meter',
    km: '{n} Kilometer',
    kmOne: '1 Kilometer',
  },
  it: {
    welcome: 'Benvenuti a {city}.',
    started: 'Il tour è iniziato. Buon divertimento!',
    freeRoam: 'Oggi niente itinerario: ti racconterò di tutto ciò che incontri.',
    left: 'Alla tua sinistra',
    right: 'Alla tua destra',
    ahead: 'Davanti a te',
    behind: 'Appena dietro di te',
    nearby: 'Qui vicino',
    inDistance: 'tra {d}',
    poiIntro: '{dir}: {title}.',
    firstStop: 'La tua prima tappa è {name}, a {d}.',
    arrived: 'Eccoti a {name}.',
    nextStop: 'Prossima tappa: {name}, a {d}.',
    tourDone: "Questa era l'ultima tappa. Grazie per il tour! Continuerò a raccontarti dei luoghi che incontri.",
    meters: '{n} metri',
    km: '{n} chilometri',
    kmOne: '1 chilometro',
  },
};

export function speechLocale(lang) {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-US';
}

/** Translate a phrase key, filling {placeholders}. Falls back to English. */
export function t(lang, key, vars = {}) {
  const template = PHRASES[lang]?.[key] ?? PHRASES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Distance as you'd say it: "350 meters", "1.2 kilometers" (rounded for listening, not surveying). */
export function formatDistance(lang, meters) {
  const m = Math.max(0, meters);
  const rounded = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
  if (rounded < 1000) return t(lang, 'meters', { n: rounded });
  const km = Math.round(m / 100) / 10;
  if (km === 1) return t(lang, 'kmOne');
  const n = new Intl.NumberFormat(lang, { maximumFractionDigits: km >= 10 ? 0 : 1 }).format(km);
  return t(lang, 'km', { n });
}
