// "Forget everything" on the privacy page: clear what Roamie keeps on this phone (settings,
// plans, the offline copy, downloaded voices, Plus). Only Roamie's own: other sites on this
// github.io address keep theirs.
import './frame-guard.js';
import { createPlus } from './plus.js';

document.getElementById('forget').addEventListener('click', async () => {
  const done = document.getElementById('forgot');
  // Plus first, while its key is still known: give this phone's place on the key back.
  await createPlus()
    .forget()
    .catch(() => {});
  try {
    for (const key of Object.keys(localStorage)) if (/^(roamie|tour-guide)[:-]/.test(key)) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage)) if (/^(roamie|tour-guide)[:-]/.test(key)) sessionStorage.removeItem(key);
  } catch {
    // storage blocked: nothing kept there anyway
  }
  try {
    for (const key of await caches.keys()) if (/^(roamie|tour-guide)-/.test(key)) await caches.delete(key);
  } catch {
    // no offline copy
  }
  try {
    const here = new URL('./', location.href).href;
    for (const reg of (await navigator.serviceWorker?.getRegistrations()) ?? []) if (reg.scope === here) await reg.unregister();
  } catch {
    // no service worker
  }
  done.hidden = false;
  done.textContent = 'Done: Roamie has forgotten everything on this phone.';
});
