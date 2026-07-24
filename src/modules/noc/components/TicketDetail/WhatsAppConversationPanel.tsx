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

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/noc/tickets/${ticketId}/whatsapp?dr=${encodeURIComponent(drNumber ?? '')}`);
    const json = await res.json();
    setItems(json?.data?.items ?? []);
    setLoading(false);
  }, [ticketId, drNumber]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading conversation…</div>;
  if (items.length === 0) return <div className="p-4 text-sm text-muted-foreground">No WhatsApp messages for this ticket.</div>;

  return (
    <div className="flex flex-col gap-2 p-2">
      {items.map((m) => (
        <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === 'outbound' ? 'self-end bg-green-100' : 'self-start bg-gray-100'}`}>
          <div className="mb-0.5 text-xs text-gray-500">
            {m.from ?? (m.direction === 'outbound' ? 'You' : 'Unknown')} · {m.channel} · {new Date(m.at).toLocaleString()}
          </div>
          <div className="whitespace-pre-wrap">{m.text}</div>
        </div>
      ))}
      {/* Reply composer is wired in Task 6. */}
    </div>
  );
}
