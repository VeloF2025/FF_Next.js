import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-level pins for three stacking-context invariants.
 *
 * These are asserted against source text rather than a rendered DOM on purpose:
 * jsdom performs no layout and loads no Tailwind stylesheet, so
 * `getComputedStyle(main).zIndex` returns '' there whatever the class list says.
 * A jsdom test would pass on the broken code and prove nothing. The browser-level
 * checks live in tests/e2e/nav-stacking-reachability.spec.ts; these pins are the
 * part that can run in unit CI.
 */
const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('AppLayout <main> must not establish a stacking context', () => {
  const src = read('src/components/layout/AppLayout.tsx');

  // AppLayout renders more than one <main> (the bare one on the no-chrome
  // branch and the attributed one on the standard branch). Asserting on the
  // first match alone passes trivially against the bare tag while the real one
  // carries z-10, so every occurrence is checked.
  const openTags = [...src.matchAll(/<main\b[^>]*>/g)].map((m) => m[0]);

  it('finds both <main> elements', () => {
    expect(openTags.length).toBe(2);
  });

  it.each(openTags.map((tag, i) => [i, tag]))(
    'renders <main> #%i without a z-index utility',
    (_i, tag) => {
      // A z-index on <main> traps every descendant modal (`fixed inset-0 z-50`)
      // beneath the module nav strip (z-30), regardless of the modal's own index.
      expect(tag as string).not.toMatch(/\bz-\[?\d/);
      expect(tag as string).not.toMatch(/zIndex/);
    },
  );
});

describe('Leaflet z-index scale stays contained', () => {
  it('globals.css isolates .leaflet-container', () => {
    const css = read('styles/globals.css');
    const rule = css.match(/\.leaflet-container\s*\{[^}]*\}/);
    expect(rule, '.leaflet-container rule missing from globals.css').not.toBeNull();
    expect(rule![0]).toMatch(/isolation:\s*isolate/);
  });

  it('the fleet map wrapper isolates the attention panel overlay', () => {
    const page = read('pages/fleet/map.tsx');
    // The wrapper that holds both <FleetMap> and <MapAttentionPanel> (z-[500]).
    expect(page).toMatch(/className="relative isolate flex-1 min-h-0"/);
  });
});
