// Once Roamie has its own address (scripts/move-site.mjs fills MOVED_TO), visitors who come to
// the old github.io address are sent to the same page at the new one. Empty: nothing happens.
export const MOVED_TO = '';
const OLD_HOST = 'dv2788.github.io';
const OLD_PREFIX = '/Tour-guide-App-/';

/** The same page at the new address, or null if this one isn't on the old address. */
export function movedUrl({ hostname, pathname, search, hash }, movedTo = MOVED_TO) {
  if (!movedTo || hostname !== OLD_HOST || !pathname.startsWith(OLD_PREFIX)) return null;
  // Leading slashes dropped: "//elsewhere.example" would otherwise leave the new address.
  const rest = pathname.slice(OLD_PREFIX.length).replace(/^[/\\]+/, '');
  const url = new URL(`${rest}${search}${hash}`, movedTo);
  return url.origin === new URL(movedTo).origin ? url.href : null;
}

const target = typeof location === 'undefined' ? null : movedUrl(location);
if (target) {
  location.replace(target);
  throw new Error('Roamie has moved: on its way to the new address.');
}
