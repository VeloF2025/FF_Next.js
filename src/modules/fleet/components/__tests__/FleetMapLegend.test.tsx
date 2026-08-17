/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

// ORDER is imported, not restated: a local copy would drift the day someone
// reorders the legend, and every assertion below zips against it by index.
import { FleetMapLegend, ORDER, RING_COLOUR } from '../FleetMapLegend';
import { STATUS_STYLE, swatchBackground } from '../../utils/liveMapHelpers';

/** Disc and ring per legend row, in render order. */
function swatches(container: HTMLElement) {
  return Array.from(container.querySelectorAll('li')).map((li) => {
    const c = li.querySelectorAll('circle');
    return {
      label: (li.textContent ?? '').replace(/\(\d+\)/, '').trim(),
      discFill: c[0]?.getAttribute('fill') ?? null,
      ringStroke: c[1]?.getAttribute('stroke') ?? null,
      dash: c[1]?.getAttribute('stroke-dasharray') ?? null,
    };
  });
}

describe('FleetMapLegend', () => {
  it('gives each row the identity colour of its OWN status', () => {
    // Asserting "some non-white hex" is not enough — every ring painted the
    // same wrong colour, or two statuses swapped, would satisfy it. Pin the
    // exact value per status.
    const { container } = render(<FleetMapLegend />);
    const rows = swatches(container);
    ORDER.forEach((status, i) => {
      expect(rows[i]?.discFill).toBe(swatchBackground(status));
    });
  });

  it('keeps the ring one neutral colour, never the status hue', () => {
    // The marker's grammar: disc = identity, ring = freshness only. Colouring
    // the ring per status would encode the hue twice and drift from that.
    const { container } = render(<FleetMapLegend />);
    for (const row of swatches(container)) {
      expect(row.ringStroke).toBe(RING_COLOUR);
    }
    // And the neutral must not be the marker's white, which is invisible here.
    expect(RING_COLOUR).not.toBe('#ffffff');
  });

  it('breaks the ring for exactly the statuses the map draws dashed', () => {
    const { container } = render(<FleetMapLegend />);
    const rows = swatches(container);
    ORDER.forEach((status, i) => {
      expect(rows[i]?.dash ?? undefined).toBe(STATUS_STYLE[status].dash);
    });
    // The pair this exists for: same fill, told apart only by the dash.
    expect(STATUS_STYLE.parked.fill).toBe(STATUS_STYLE.parkedSilent.fill);
    expect(STATUS_STYLE.parked.dash).toBeUndefined();
    expect(STATUS_STYLE.parkedSilent.dash).toBeTruthy();
  });

  it('renders every status, in urgency order', () => {
    const { container } = render(<FleetMapLegend />);
    expect(swatches(container).map((r) => r.label)).toEqual(
      ORDER.map((s) => STATUS_STYLE[s].label)
    );
  });

  it('shows counts when given and omits them when not', () => {
    const { container: withCounts } = render(<FleetMapLegend counts={{ parked: 4 }} />);
    expect(withCounts.textContent).toContain('(4)');
    const { container: without } = render(<FleetMapLegend />);
    expect(without.textContent).not.toMatch(/\(\d+\)/);
  });

  it('lists every status the map can draw — nothing else catches a missed one', () => {
    // VehicleStatus gaining a member forces a STATUS_STYLE entry (it's an
    // exhaustive Record, so tsc catches that), but ORDER is a plain array —
    // TypeScript does not require it to be exhaustive, and this test file
    // iterating ORDER.forEach(...) would keep passing even with a status
    // missing from it. STATUS_STYLE's keys ARE exhaustive, so compare against
    // those rather than restating the status list here.
    expect([...ORDER].sort()).toEqual(Object.keys(STATUS_STYLE).sort());
  });
});
