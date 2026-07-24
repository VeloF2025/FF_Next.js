'use client';
import { useEffect, useState, useCallback } from 'react';

type Item = {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'group' | 'cloud' | 'waha';
  from: string | null;
  text: string;
  at: string;
};

export function WhatsAppConversationPanel({ ticketId, drNumber }: { ticketId: string; drNumber?: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/noc/tickets/${ticketId}/whatsapp?dr=${encodeURIComponent(drNumber ?? '')}`);
    const json = await res.json();
    setItems(json?.data?.items ?? []);
    setLoading(false);
  }, [ticketId, drNumber]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!draft.trim() || !toPhone.trim()) return;
    setSending(true);
    await fetch(`/api/noc/tickets/${ticketId}/whatsapp/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toPhone: toPhone.trim(), message: draft.trim() }),
    });
    setDraft('');
    setSending(false);
    await load();
  };

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading conversation…</div>;

  return (
    <div className="flex flex-col gap-2 p-2">
      {items.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No WhatsApp messages for this ticket.</div>
      ) : (
        items.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === 'outbound' ? 'self-end bg-green-100' : 'self-start bg-gray-100'}`}>
            <div className="mb-0.5 text-xs text-gray-500">
              {m.from ?? (m.direction === 'outbound' ? 'You' : 'Unknown')} · {m.channel} · {new Date(m.at).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap">{m.text}</div>
          </div>
        ))
      )}

      <div className="mt-2 flex flex-col gap-2 border-t pt-2">
        <input
          className="rounded border px-2 py-1 text-sm"
          placeholder="Recipient phone (e.g. 27821234567)"
          value={toPhone}
          onChange={(e) => setToPhone(e.target.value)}
        />
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded border px-2 py-1 text-sm"
            rows={2}
            placeholder="Type a reply…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="self-end rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={sending || !draft.trim() || !toPhone.trim()}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
