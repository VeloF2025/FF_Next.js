/**
 * The failure mode this guards is a heading with nothing under it.
 *
 * Callers pass `{cond && <Tile/>}`, which evaluates to `false` — not nothing —
 * so a `children.length` check would happily render "Tools" over an empty grid
 * for any driver without Stores or SiteCam.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TileGroup } from '../TileGroup';

describe('TileGroup', () => {
  it('renders the heading and its tiles when children are visible', () => {
    render(<TileGroup title="My vehicle"><button>Vehicle</button></TileGroup>);
    expect(screen.getByText('My vehicle')).toBeTruthy();
    expect(screen.getByText('Vehicle')).toBeTruthy();
  });

  it('renders NOTHING when every child is a false condition', () => {
    // The regression: `false` children are truthy-length, not absent.
    const { container } = render(
      <TileGroup title="Tools">{false}{false}</TileGroup>
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Tools')).toBeNull();
  });

  it('renders NOTHING for null/undefined children', () => {
    const { container } = render(<TileGroup title="Tools">{null}{undefined}</TileGroup>);
    expect(container.innerHTML).toBe('');
  });

  it('keeps the group when only SOME children are hidden', () => {
    render(
      <TileGroup title="Tools">{false}<button>SiteCam</button></TileGroup>
    );
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('SiteCam')).toBeTruthy();
  });
});
