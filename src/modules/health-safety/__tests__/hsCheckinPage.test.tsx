import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: ReactNode }) => children,
}));

import HsCheckinPage from '../../../../pages/my/hs-checkin';

describe('/my/hs-checkin bootstrap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the error banner when the bootstrap response is non-ok', async () => {
    const json = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json,
      })
    );

    render(<HsCheckinPage />);

    expect(
      await screen.findByText('Could not load the check-in. Check your signal and try again.')
    ).toBeInTheDocument();
    expect(json).not.toHaveBeenCalled();
  });
});
