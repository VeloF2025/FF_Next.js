import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/noc/services/waMaintenanceProcessor', () => ({ getMessagesForDR: vi.fn() }));
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

import { getMessagesForDR } from '@/modules/noc/services/waMaintenanceProcessor';
import { buildConversation } from '@/app/api/noc/tickets/[id]/whatsapp/route';

beforeEach(() => vi.clearAllMocks());

describe('buildConversation merges group + 1:1 streams sorted by time', () => {
  it('interleaves inbound group mentions and 1:1 messages ascending', async () => {
    // Recon deviation: the real getMessagesForDR returns `id` (not `wa_message_id`)
    // and `message_timestamp` as a Date; buildConversation maps `id` and
    // normalizes timestamps to ISO strings.
    vi.mocked(getMessagesForDR).mockResolvedValue([
      { id: 'g1', sender_name: 'Tech', message_text: 'DR123 down', message_timestamp: '2026-07-24T08:00:00Z' },
    ] as never);
    const logs = [
      { id: 'c1', direction: 'outbound', service: 'cloud', recipient_jid: '27820000000', message_content: 'On it', created_at: '2026-07-24T08:05:00Z' },
    ];
    const items = await buildConversation('DR123', logs as never);
    expect(items.map((i) => i.id)).toEqual(['g1', 'c1']);
    expect(items[0]).toMatchObject({ direction: 'inbound', channel: 'group', text: 'DR123 down' });
    expect(items[1]).toMatchObject({ direction: 'outbound', channel: 'cloud', text: 'On it' });
  });
});
