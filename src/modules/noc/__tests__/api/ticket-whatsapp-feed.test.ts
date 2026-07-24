import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/modules/noc/services/waMaintenanceProcessor', () => ({ getMessagesForDR: vi.fn() }));
vi.mock('@/lib/auth/app-router', () => ({ requireAuth: vi.fn() }));
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }));

import { getMessagesForDR } from '@/modules/noc/services/waMaintenanceProcessor';
import { requireAuth } from '@/lib/auth/app-router';
import { buildConversation, GET } from '@/app/api/noc/tickets/[id]/whatsapp/route';

beforeEach(() => { vi.clearAllMocks(); sqlMock.mockReset(); });

describe('buildConversation merges group + 1:1 streams sorted by time', () => {
  it('interleaves inbound group mentions and 1:1 messages ascending', async () => {
    // Real getMessagesForDR returns `id` (not `wa_message_id`) and a Date; buildConversation
    // maps `id` and normalizes timestamps to ISO.
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

  it('sorts strictly by time even when the 1:1 message precedes the group message', async () => {
    vi.mocked(getMessagesForDR).mockResolvedValue([
      { id: 'g1', sender_name: 'Tech', message_text: 'later', message_timestamp: '2026-07-24T08:10:00Z' },
    ] as never);
    const logs = [
      { id: 'c1', direction: 'inbound', service: 'waha', recipient_jid: '27820000000', message_content: 'earlier', created_at: '2026-07-24T08:00:00Z' },
    ];
    const items = await buildConversation('DR123', logs as never);
    expect(items.map((i) => i.id)).toEqual(['c1', 'g1']);
  });

  it('labels outbound 1:1 as "You" by leaving from null (and handles null DR)', async () => {
    const logs = [
      { id: 'c1', direction: 'outbound', service: 'cloud', recipient_jid: '27820000000', message_content: 'hi', created_at: '2026-07-24T08:00:00Z' },
    ];
    const items = await buildConversation(null, logs as never);
    expect(getMessagesForDR).not.toHaveBeenCalled();
    expect(items[0].from).toBeNull();
  });
});

describe('GET feed route', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue([null, NextResponse.json({ success: false }, { status: 401 })] as never);
    const res = await GET({} as never, { params: Promise.resolve({ id: 't1' }) } as never);
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('derives the DR from the ticket server-side and scopes the 1:1 query to it', async () => {
    vi.mocked(requireAuth).mockResolvedValue([{ id: 'u1', role: 'admin' }, null] as never);
    vi.mocked(getMessagesForDR).mockResolvedValue([
      { id: 'g1', sender_name: 'Tech', message_text: 'grp', message_timestamp: '2026-07-24T08:00:00Z' },
    ] as never);
    sqlMock
      .mockResolvedValueOnce([{ dr_number: 'DR123' }]) // ticket lookup
      .mockResolvedValueOnce([{ id: 'c1', direction: 'outbound', service: 'cloud', recipient_jid: '27820000000', message_content: 'reply', created_at: '2026-07-24T08:05:00Z' }]); // scoped logs
    const res = await GET({} as never, { params: Promise.resolve({ id: 't1' }) } as never);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items.map((i: { id: string }) => i.id)).toEqual(['g1', 'c1']);
    expect(sqlMock).toHaveBeenCalledTimes(2); // ticket lookup + scoped logs, never a system-wide query
    expect(getMessagesForDR).toHaveBeenCalledWith('DR123');
  });
});
