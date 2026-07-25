import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WaTestSendCard from './WaTestSendCard';

afterEach(() => vi.unstubAllGlobals());

function stubSend(data: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { success: true, data } : { success: false, error: 'HTTP 500' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function typePhoneAndSend(phone = '0821234567') {
  fireEvent.change(screen.getByLabelText(/Recipient number/i), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: /Send test message/i }));
}

describe('WaTestSendCard', () => {
  it('will not send without a recipient number', () => {
    const fetchMock = stubSend({ ok: true, channel: 'cloud' });

    render(<WaTestSendCard />);
    fireEvent.click(screen.getByRole('button', { name: /Send test message/i }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the operator-typed number to the test-send endpoint', async () => {
    const fetchMock = stubSend({ ok: true, channel: 'cloud', providerMessageId: 'wamid.OK' });

    render(<WaTestSendCard />);
    typePhoneAndSend('082 123 4567');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/communications/whatsapp/test-send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ toPhone: '082 123 4567' });
  });

  it('shows the provider message id on success', async () => {
    stubSend({ ok: true, channel: 'cloud', providerMessageId: 'wamid.OK' });

    render(<WaTestSendCard />);
    typePhoneAndSend();

    await waitFor(() => expect(screen.getByTestId('wa-test-send-result')).toHaveTextContent(/wamid.OK/));
  });

  it('shows the real error text when the send fails', async () => {
    stubSend({ ok: false, channel: 'cloud', error: 'Graph 401: invalid access token' });

    render(<WaTestSendCard />);
    typePhoneAndSend();

    await waitFor(() =>
      expect(screen.getByTestId('wa-test-send-result')).toHaveTextContent(/Graph 401: invalid access token/)
    );
  });

  it('calls out incomplete credentials rather than showing a bare failure', async () => {
    stubSend({ ok: false, channel: 'cloud', notConfigured: true, error: 'Cloud credentials are not fully configured' });

    render(<WaTestSendCard />);
    typePhoneAndSend();

    await waitFor(() =>
      expect(screen.getByTestId('wa-test-send-result')).toHaveTextContent(/not fully configured/i)
    );
  });

  it('surfaces a transport-level failure instead of failing silently', async () => {
    stubSend(null, false);

    render(<WaTestSendCard />);
    typePhoneAndSend();

    await waitFor(() => expect(screen.getByTestId('wa-test-send-result')).toHaveTextContent(/HTTP 500/));
  });
});
