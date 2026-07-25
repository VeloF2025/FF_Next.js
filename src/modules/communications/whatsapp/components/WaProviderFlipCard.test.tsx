import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WaProviderFlipCard from './WaProviderFlipCard';

afterEach(() => vi.unstubAllGlobals());

function stubFlip(data: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { success: true, data } : { success: false, error: 'Cloud is not configured' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderCard(props: Partial<React.ComponentProps<typeof WaProviderFlipCard>> = {}) {
  return render(
    <WaProviderFlipCard provider="bridge" cloudConfigured onFlipped={props.onFlipped ?? vi.fn()} {...props} />
  );
}

describe('WaProviderFlipCard', () => {
  // The single most important behaviour: one stray click must not move the
  // live provider.
  it('does not call the API on the first click — it asks for confirmation', async () => {
    const fetchMock = stubFlip({ provider: 'cloud' });

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));

    expect(await screen.findByTestId('wa-flip-confirm')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flips only after the confirmation is accepted', async () => {
    const fetchMock = stubFlip({ provider: 'cloud' });

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Yes, switch to cloud/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/communications/whatsapp/provider');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({ provider: 'cloud', confirm: true });
  });

  it('cancelling the confirmation leaves the provider alone', async () => {
    const fetchMock = stubFlip({ provider: 'cloud' });

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/i }));

    await waitFor(() => expect(screen.queryByTestId('wa-flip-confirm')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers the reverse switch when cloud is already active', () => {
    stubFlip({ provider: 'bridge' });

    renderCard({ provider: 'cloud' });

    expect(screen.getByRole('button', { name: /Switch to bridge/i })).toBeInTheDocument();
  });

  it('blocks the switch to cloud while credentials are incomplete', () => {
    stubFlip({ provider: 'cloud' });

    renderCard({ cloudConfigured: false });

    expect(screen.getByRole('button', { name: /Switch to cloud/i })).toBeDisabled();
  });

  it('reports a rejected flip instead of implying success', async () => {
    stubFlip(null, false);
    const onFlipped = vi.fn();

    renderCard({ onFlipped });
    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Yes, switch to cloud/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not configured/i));
    expect(onFlipped).not.toHaveBeenCalled();
  });

  // Scope note, so nobody reads more into this than it proves: jsdom will not
  // dispatch a click on a button React has already marked disabled, so this
  // exercises the disabled attribute, NOT handleConfirm's `if (flipping)`
  // re-entry guard. It pins the user-facing guarantee — the rendered button
  // cannot be double-clicked into two flips — and would fail if `disabled`
  // were dropped. The internal guard is defence in depth for a real browser's
  // double-click timing, which jsdom cannot simulate.
  it('renders the confirm button disabled once flipping, so a second click cannot fire', async () => {
    const fetchMock = stubFlip({ provider: 'cloud' });

    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));
    const confirm = await screen.findByRole('button', { name: /Yes, switch to cloud/i });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('notifies the parent so readiness can be re-read after a successful flip', async () => {
    stubFlip({ provider: 'cloud' });
    const onFlipped = vi.fn();

    renderCard({ onFlipped });
    fireEvent.click(screen.getByRole('button', { name: /Switch to cloud/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Yes, switch to cloud/i }));

    await waitFor(() => expect(onFlipped).toHaveBeenCalledOnce());
  });
});
