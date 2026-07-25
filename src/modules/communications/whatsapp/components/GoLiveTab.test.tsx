import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import GoLiveTab from './GoLiveTab';

afterEach(() => vi.unstubAllGlobals());

function stubReadiness(data: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { success: true, data } : { success: false, error: 'boom' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const BRIDGE_READINESS = {
  provider: 'bridge',
  cloudConfigured: false,
  cloudConfig: [
    { key: 'cloud_phone_number_id', present: true },
    { key: 'cloud_access_token', present: false },
    { key: 'cloud_app_secret', present: false },
    { key: 'cloud_verify_token', present: false },
  ],
};

describe('GoLiveTab', () => {
  it('loads readiness from the API and shows the active provider', async () => {
    const fetchMock = stubReadiness(BRIDGE_READINESS);

    render(<GoLiveTab />);

    await waitFor(() => expect(screen.getByTestId('wa-active-provider')).toHaveTextContent('bridge'));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/communications/whatsapp/readiness');
  });

  it('shows presence — not values — for every cloud config key', async () => {
    stubReadiness(BRIDGE_READINESS);

    render(<GoLiveTab />);

    await waitFor(() => expect(screen.getByTestId('wa-key-cloud_access_token')).toBeInTheDocument());
    expect(screen.getByTestId('wa-key-cloud_phone_number_id')).toHaveTextContent(/Set/);
    expect(screen.getByTestId('wa-key-cloud_access_token')).toHaveTextContent(/Not set/);
    expect(screen.getByTestId('wa-key-cloud_app_secret')).toHaveTextContent(/Not set/);
    expect(screen.getByTestId('wa-key-cloud_verify_token')).toHaveTextContent(/Not set/);
  });

  it('renders the static go-live checklist', async () => {
    stubReadiness(BRIDGE_READINESS);

    render(<GoLiveTab />);

    await waitFor(() => expect(screen.getByTestId('wa-golive-checklist')).toBeInTheDocument());
    const items = screen.getAllByTestId(/^wa-checklist-item-/);
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it('surfaces a load failure instead of rendering a blank panel', async () => {
    stubReadiness(null, false);

    render(<GoLiveTab />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
