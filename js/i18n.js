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

// The documentary narrator's way of speaking: unhurried, a touch of wonder, "we".
// Keys not listed fall back to the standard phrases.
const DOCUMENTARY = {
  en: {
    welcome: 'Welcome to {city}. Let us take a closer look.',
    started: 'Our journey begins.',
    freeRoam: "There is no fixed route today. We shall simply see what we find.",
    left: 'And here, on your left',
    right: 'Now, on your right',
    ahead: 'Just ahead of us',
    behind: 'Behind us now',
    nearby: 'Nearby',
    poiIntro: '{dir}… {title}.',
    firstStop: 'Our first stop is {name}, some {d} away.',
    arrived: 'And so, we arrive at {name}.',
    nextStop: 'Our journey continues to {name}, {d} from here.',
    tourDone: 'And that brings our journey to its end. But this city still has stories to tell, and I shall share them as we go.',
  },
  fr: {
    welcome: 'Bienvenue à {city}. Regardons de plus près.',
    started: 'Notre voyage commence.',
    freeRoam: "Pas d'itinéraire aujourd'hui. Nous verrons bien ce que nous découvrirons.",
    left: 'Et ici, sur votre gauche',
    right: 'Et là, sur votre droite',
    ahead: 'Juste devant nous',
    behind: 'Derrière nous, à présent',
    nearby: 'Tout près',
    poiIntro: '{dir}… {title}.',
    firstStop: 'Notre première étape : {name}, à quelque {d}.',
    arrived: 'Et nous voici à {name}.',
    nextStop: 'Notre voyage se poursuit vers {name}, à {d} d’ici.',
    tourDone: "Ainsi s'achève notre voyage. Mais la ville a encore bien des histoires à raconter, et je vous les confierai en chemin.",
  },
  es: {
    welcome: 'Bienvenidos a {city}. Observemos con atención.',
    started: 'Nuestro viaje comienza.',
    freeRoam: 'Hoy no hay ruta fija. Veremos qué descubrimos.',
    left: 'Y aquí, a nuestra izquierda',
    right: 'Y ahora, a nuestra derecha',
    ahead: 'Justo delante de nosotros',
    behind: 'Ya detrás de nosotros',
    nearby: 'Muy cerca',
    poiIntro: '{dir}… {title}.',
    firstStop: 'Nuestra primera parada: {name}, a unos {d}.',
    arrived: 'Y así llegamos a {name}.',
    nextStop: 'Nuestro viaje continúa hacia {name}, a {d} de aquí.',
    tourDone: 'Y así termina nuestro viaje. Pero la ciudad aún guarda historias, y te las contaré por el camino.',
  },
  de: {
    welcome: 'Willkommen in {city}. Sehen wir uns genauer um.',
    started: 'Unsere Reise beginnt.',
    freeRoam: 'Heute gibt es keine feste Route. Mal sehen, was wir entdecken.',
    left: 'Und hier, zu unserer Linken',
    right: 'Und nun, zu unserer Rechten',
    ahead: 'Direkt vor uns',
    behind: 'Nun schon hinter uns',
    nearby: 'Ganz in der Nähe',
    poiIntro: '{dir}… {title}.',
    firstStop: 'Unser erster Halt: {name}, etwa {d} entfernt.',
    arrived: 'Und so erreichen wir {name}.',
    nextStop: 'Unsere Reise führt weiter zu {name}, {d} von hier.',
    tourDone: 'Damit endet unsere Reise. Doch die Stadt hat noch viele Geschichten zu erzählen, und ich erzähle sie Ihnen unterwegs.',
  },
};
const STYLES = { documentary: DOCUMENTARY };

export function speechLocale(lang) {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-US';
}

/** Translate a phrase key, filling {placeholders}. Falls back to the standard style, then English. */
export function t(lang, key, vars = {}, style = 'standard') {
  const template = STYLES[style]?.[lang]?.[key] ?? PHRASES[lang]?.[key] ?? PHRASES.en[key] ?? key;
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
