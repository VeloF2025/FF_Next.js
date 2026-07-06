import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SiteCamOfflineStatus } from '../SiteCamOfflineStatus';

describe('SiteCamOfflineStatus', () => {
  it('renders the saved-offline message and the sync-count indicator', () => {
    render(<SiteCamOfflineStatus photoCount={3} uploadError={null} flushing={false} onRetry={vi.fn()} />);

    expect(screen.getByText('Saved offline')).toBeTruthy();
    expect(screen.getByText(/3 photos saved on this device/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('singularizes the photo count for exactly one photo', () => {
    render(<SiteCamOfflineStatus photoCount={1} uploadError={null} flushing={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/1 photo saved on this device/)).toBeTruthy();
  });

  it('shows the couldn\'t-submit banner when a definitive flush error is present', () => {
    render(
      <SiteCamOfflineStatus photoCount={1} uploadError="Site not found" flushing={false} onRetry={vi.fn()} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't submit");
    expect(alert.textContent).toContain('Site not found');
  });

  it('calls onRetry when the "Try again now" button is tapped', () => {
    const onRetry = vi.fn();
    render(<SiteCamOfflineStatus photoCount={1} uploadError={null} flushing={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Try again now'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the retry button and shows "Trying…" while flushing', () => {
    render(<SiteCamOfflineStatus photoCount={1} uploadError={null} flushing onRetry={vi.fn()} />);
    const button = screen.getByText('Trying…').closest('button');
    expect(button).toBeDisabled();
  });
});
