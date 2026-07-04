import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { InstallPrompt } from '../InstallPrompt';

// React 18's automatic batching defers the state-update flush from a native
// `window.dispatchEvent` to a microtask, since the listener is attached via
// a raw `addEventListener` (not React's synthetic event system). Without
// `act()`, the assertion below runs before the resulting re-render commits.
// `fireEvent` (used for the "Not now" click) wraps dispatch in `act()`
// internally; this manual dispatch needs the same wrapping explicitly.
function fireBeforeInstall() {
  const e = new Event('beforeinstallprompt') as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
  e.prompt = async () => {};
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => {
    window.dispatchEvent(e);
  });
}

describe('InstallPrompt', () => {
  beforeEach(() => localStorage.clear());

  it('is hidden until beforeinstallprompt fires', () => {
    render(<InstallPrompt />);
    expect(screen.queryByText(/install fibreflow/i)).toBeNull();
  });

  it('shows after beforeinstallprompt and hides after dismiss (persisted)', () => {
    render(<InstallPrompt />);
    fireBeforeInstall();
    expect(screen.getByText(/install fibreflow/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByText(/install fibreflow/i)).toBeNull();
    expect(localStorage.getItem('ff-install-dismissed')).toBe('1');
  });
});
