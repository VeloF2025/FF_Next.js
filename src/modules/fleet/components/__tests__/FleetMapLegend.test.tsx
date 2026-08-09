/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { FleetMapLegend } from '../FleetMapLegend';
import { STATUS_STYLE } from '../../utils/liveMapHelpers';

/** The swatch <circle> that carries the ring, i.e. the second one. */
function rings(container: HTMLElement) {
  return Array.from(container.querySelectorAll('li')).map((li) => {
    const circles = li.querySelectorAll('circle');
    return {
      label: li.textContent ?? '',
      dash: circles[1]?.getAttribute('stroke-dasharray') ?? null,
      stroke: circles[1]?.getAttribute('stroke') ?? null,
    };
  });
}

describe('FleetMapLegend', () => {
  it('breaks the ring for exactly the statuses the map draws dashed', () => {
    // parkedSilent shares parked's exact fill, so without the dash the legend
    // shows two swatches that differ only in opacity and never explains what
    // the broken ring on the map means.
    const { container } = render(<FleetMapLegend />);
    const byLabel = new Map(rings(container).map((r) => [r.label.trim(), r.dash]));

    expect(byLabel.get('Parked')).toBeNull();
    expect(byLabel.get('Parked · no contact')).toBe(STATUS_STYLE.parkedSilent.dash);
    expect(byLabel.get('Lost contact')).toBe(STATUS_STYLE.lostContact.dash);
    expect(byLabel.get('Speeding')).toBeNull();
  });

  it('draws the ring in the status colour, not white', () => {
    // A white ring has nothing to show against the pale header — it notches
    // the disc instead, and the swatch reads as a spiky blob.
    const { container } = render(<FleetMapLegend />);
    for (const r of rings(container)) {
      expect(r.stroke).not.toBe('#ffffff');
      expect(r.stroke).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('renders every status, in urgency order', () => {
    const { container } = render(<FleetMapLegend />);
    const labels = rings(container).map((r) => r.label.replace(/\(\d+\)/, '').trim());
    expect(labels).toEqual([
      STATUS_STYLE.speeding.label,
      STATUS_STYLE.lostContact.label,
      STATUS_STYLE.moving.label,
      STATUS_STYLE.parked.label,
      STATUS_STYLE.parkedSilent.label,
      STATUS_STYLE.unknown.label,
    ]);
  });

  it('shows counts when given and omits them when not', () => {
    const { container: withCounts } = render(<FleetMapLegend counts={{ parked: 4 }} />);
    expect(withCounts.textContent).toContain('(4)');
    const { container: without } = render(<FleetMapLegend />);
    expect(without.textContent).not.toMatch(/\(\d+\)/);
  });
});
