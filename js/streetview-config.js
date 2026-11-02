// Google Street View in first person: real photos of the street you're on, instead of the 3D
// map. Off until a Google Maps Platform browser key is set here (see docs/street-view.md for the
// steps, the costs and Google's rules). A browser key isn't a secret, it ends up in the page,
// but it must be restricted to this site's address in Google Cloud, or anyone could spend
// your quota.

export const STREET_VIEW_CONFIG = {
  apiKey: '',
  // The nearest photo within this many metres of where you are.
  radius: 40,
  // Look for the next photo once you've moved this far (m).
  stepMeters: 5,
  // After you've looked around by hand, the view stops turning with the street for this long (s).
  freeLookSeconds: 8,
};
