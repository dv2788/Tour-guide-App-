// Roamie Plus settings. Plus stays switched off (Roamie entirely free) until the two Polar
// values below are filled in: see docs/plus.md. Neither is a secret; both end up in the page.

export const PLUS_CONFIG = {
  // Polar organisation id (Polar dashboard → Settings → Organization → Identifier, a UUID).
  organizationId: '',
  // Polar checkout link for the "Roamie Plus" product (Products → Checkout links), https://buy.polar.sh/…
  checkoutUrl: '',
  // Where buyers find their key again and free a phone: Polar's customer portal, https://polar.sh/<your-org>/portal
  portalUrl: '',
  // As shown in the app; must match the product's price in Polar.
  price: '€9.99',
  // How many cities you can walk for real before Plus. Tours "from the couch" never count.
  freeCities: 1,
  // A place this close to a city already walked counts as the same city (suburbs, day trips).
  sameCityKm: 25,
  // How often the key is checked again while online (a refunded key stops working).
  recheckDays: 7,
};
