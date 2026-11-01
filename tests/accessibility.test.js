import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text must stay readable (WCAG AA: 4.5:1) in both themes, and keyboard focus visible (3:1).
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = tokens(css.match(/^:root\s*\{([\s\S]*?)\n\}/m)[1]);
const dark = { ...light, ...tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root[^{]*\{([\s\S]*?)\}/)[1]) };

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('text colours meet WCAG AA (4.5:1) on every background, in light and dark', () => {
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    for (const fg of ['ink', 'muted', 'gold']) {
      for (const bg of ['bg', 'surface', 'surface-2', 'soft']) {
        const ratio = contrast(theme[fg], theme[bg]);
        assert.ok(ratio >= 4.5, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('keyboard focus is drawn in a colour that stands out (3:1 or more)', () => {
  const outlines = [...css.matchAll(/outline:\s*\d+px solid var\(--([\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(outlines.length >= 5, 'focus outlines found');
  for (const token of new Set(outlines)) {
    for (const [name, theme] of [['light', light], ['dark', dark]]) {
      assert.ok(contrast(theme[token], theme.bg) >= 3, `${name}: focus outline (${token}) is ${contrast(theme[token], theme.bg).toFixed(2)}:1`);
    }
  }
});
