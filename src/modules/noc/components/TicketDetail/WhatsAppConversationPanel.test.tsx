import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WhatsAppConversationPanel } from './WhatsAppConversationPanel';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { items: [
      { id: 'g1', direction: 'inbound', channel: 'group', from: 'Tech', text: 'DR123 down', at: '2026-07-24T08:00:00Z' },
    ] } }),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('WhatsAppConversationPanel', () => {
  it('loads and renders the conversation feed for the ticket DR', async () => {
    render(<WhatsAppConversationPanel ticketId="t1" drNumber="DR123" />);
    await waitFor(() => expect(screen.getByText('DR123 down')).toBeInTheDocument());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/api/noc/tickets/t1/whatsapp?dr=DR123');
  });
});
