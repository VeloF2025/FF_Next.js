import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WhatsAppConversationPanel } from './WhatsAppConversationPanel';

afterEach(() => vi.unstubAllGlobals());

describe('WhatsAppConversationPanel', () => {
  it('loads and renders the conversation feed for the ticket DR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { items: [
        { id: 'g1', direction: 'inbound', channel: 'group', from: 'Tech', text: 'DR123 down', at: '2026-07-24T08:00:00Z' },
      ] } }),
    }));
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR123" />);
    await waitFor(() => expect(screen.getByText('DR123 down')).toBeInTheDocument());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/api/noc/tickets/t1/whatsapp?dr=DR123');
  });

  it('clears the draft after a successful reply send', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/reply')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, providerMessageId: 'wamid.1' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { items: [] } }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR1" />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Recipient phone/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Recipient phone/), { target: { value: '27820000000' } });
    fireEvent.change(screen.getByPlaceholderText(/Type a reply/), { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/reply'))).toBe(true));
    await waitFor(() => expect((screen.getByPlaceholderText(/Type a reply/) as HTMLTextAreaElement).value).toBe(''));
  });

  it('keeps the draft and surfaces an error when the send fails', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/reply')) {
        return Promise.resolve({ ok: false, status: 502, json: async () => ({ success: false, error: 'send failed' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { items: [] } }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR1" />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Recipient phone/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Recipient phone/), { target: { value: '27820000000' } });
    fireEvent.change(screen.getByPlaceholderText(/Type a reply/), { target: { value: 'keep me' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('send failed')).toBeInTheDocument());
    // draft must NOT be cleared on failure, and Send must be usable again
    expect((screen.getByPlaceholderText(/Type a reply/) as HTMLTextAreaElement).value).toBe('keep me');
    expect((screen.getByText('Send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('auto-resolves the recipient phone from the ticket client contact when it is a usable SA number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, data: { items: [] } }),
    }));
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR1" clientContact="0821234567" />);
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/Recipient phone/) as HTMLInputElement).value).toBe('27821234567'));
    expect(screen.queryByText(/could not auto-resolve/i)).not.toBeInTheDocument();
  });

  it('leaves the recipient phone empty and shows a clear notice when the contact cannot be resolved to a number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, data: { items: [] } }),
    }));
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR1" clientContact="Ask at the gate for Sipho" />);
    await waitFor(() => expect(screen.getByText(/could not auto-resolve/i)).toBeInTheDocument());
    expect((screen.getByPlaceholderText(/Recipient phone/) as HTMLInputElement).value).toBe('');
    // never a wrong number: Send must stay disabled until the operator supplies one
    expect((screen.getByText('Send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the same clear notice when the ticket has no client contact at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, data: { items: [] } }),
    }));
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR1" clientContact={null} />);
    await waitFor(() => expect(screen.getByText(/could not auto-resolve/i)).toBeInTheDocument());
    expect((screen.getByPlaceholderText(/Recipient phone/) as HTMLInputElement).value).toBe('');
  });

  it('still lets the operator type a number manually after an auto-resolve failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, data: { items: [] } }),
    }));
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR1" clientContact={null} />);
    await waitFor(() => expect(screen.getByText(/could not auto-resolve/i)).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Recipient phone/), { target: { value: '27820000000' } });
    expect((screen.getByPlaceholderText(/Recipient phone/) as HTMLInputElement).value).toBe('27820000000');
  });
});
