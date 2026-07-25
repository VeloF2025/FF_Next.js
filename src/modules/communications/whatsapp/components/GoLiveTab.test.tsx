import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GoLiveTab from './GoLiveTab';
import { WA_GO_LIVE_CHECKLIST } from './goLiveChecklist';

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

/** On bridge, but fully configured — so the flip control is live. */
const CLOUD_READY_ON_BRIDGE = {
  provider: 'bridge',
  cloudConfigured: true,
  cloudConfig: BRIDGE_READINESS.cloudConfig.map((c) => ({ ...c, present: true })),
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

  it('renders every static go-live checklist item', async () => {
    stubReadiness(BRIDGE_READINESS);

    render(<GoLiveTab />);

    await waitFor(() => expect(screen.getByTestId('wa-golive-checklist')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^wa-checklist-item-/)).toHaveLength(WA_GO_LIVE_CHECKLIST.length);
  });

  it('surfaces a load failure instead of rendering a blank panel', async () => {
    stubReadiness(null, false);

    render(<GoLiveTab />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  // A failed *refresh* must not throw away a panel that is already loaded — the
  // operator loses the provider display, the test send and the flip control
  // over a transient blip.
  it('keeps the loaded panel when a refresh fails, showing the error inline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: BRIDGE_READINESS }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: 'gateway blip' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<GoLiveTab />);
    await waitFor(() => expect(screen.getByTestId('wa-active-provider')).toHaveTextContent('bridge'));

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/gateway blip/));
    // The panel survived.
    expect(screen.getByTestId('wa-active-provider')).toHaveTextContent('bridge');
    expect(screen.getByTestId('wa-golive-checklist')).toBeInTheDocument();
  });

  // Two readiness reads really can overlap: the Refresh button is disabled
  // while one is in flight, but a completed flip triggers its own re-read
  // programmatically via onFlipped. If the earlier, slower response were
  // allowed to land last it would paint the pre-flip provider back over the
  // post-flip one — the panel would claim the flip had not happened.
  it('ignores a slow earlier readiness response that lands after a newer one', async () => {
    let resolveSlowRefresh: (v: unknown) => void = () => {};
    const slowRefresh = new Promise((r) => { resolveSlowRefresh = r; });

    let readinessCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/provider')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { provider: 'cloud' } }) });
      }
      readinessCalls += 1;
      if (readinessCalls === 1) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: CLOUD_READY_ON_BRIDGE }) });
      }
      if (readinessCalls === 2) {
        return slowRefresh;   // manual refresh — still in flight
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { ...CLOUD_READY_ON_BRIDGE, provider: 'cloud' } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GoLiveTab />);
    await waitFor(() => expect(screen.getByTestId('wa-active-provider')).toHaveTextContent('bridge'));

    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));          // read #2, slow

    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Yes, switch to cloud/i }));

    // The flip's own re-read (#3) lands first and wins.
    await waitFor(() => expect(screen.getByTestId('wa-active-provider')).toHaveTextContent('cloud'));

    // Now the stale refresh finally answers with the pre-flip value.
    resolveSlowRefresh({ ok: true, json: async () => ({ success: true, data: CLOUD_READY_ON_BRIDGE }) });

    await waitFor(() => expect(screen.getByTestId('wa-active-provider')).toHaveTextContent('cloud'));
  });
});
