// Roamie only runs as itself, never inside another site's frame: a page could otherwise lay
// invisible buttons over it to trick taps ("clickjacking"). GitHub Pages can't send the header
// that forbids framing, so the page checks for itself and stops before anything else runs.
let framed = true;
try {
  framed = window.top !== window.self;
} catch {
  framed = true; // a cross-origin parent: framed
}

if (framed) {
  const link = document.createElement('a');
  link.href = location.href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open Roamie';
  const note = document.createElement('p');
  note.textContent = 'Roamie works in its own window. ';
  note.append(link);
  document.body.replaceChildren(note);
  throw new Error('Roamie was loaded inside another page: stopped.');
}
