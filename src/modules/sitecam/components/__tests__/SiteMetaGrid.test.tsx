import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SiteMetaGrid } from '../SiteMetaGrid';

describe('SiteMetaGrid', () => {
  it('renders PON, zone and planned coords when all present', () => {
    render(<SiteMetaGrid pon={12} zone={4} plannedLat={-26.123456} plannedLon={27.567890} />);
    expect(screen.getByText(/PON/)).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(/Zone/)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText(/-26\.12346, 27\.56789/)).toBeTruthy(); // 5dp
  });

  it('hides the coord row when coords are null', () => {
    render(<SiteMetaGrid pon={12} zone={4} plannedLat={null} plannedLon={null} />);
    expect(screen.queryByText(/,/)).toBeNull();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders nothing when every field is null', () => {
    const { container } = render(
      <SiteMetaGrid pon={null} zone={null} plannedLat={null} plannedLon={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
