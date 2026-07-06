/**
 * Ticket header for the public snag/resolve page: UID + status pill, title,
 * project, and the "logged in as" actor chip. Presentational only — extracted
 * from the page to keep it under the component-size limit.
 */

import { User } from 'lucide-react';
import { STATUS_LABELS, STATUS_COLORS, STATUS_COLOR_FALLBACK } from './session';
import type { SharedTicket, SessionActor } from './types';

export function ResolveTicketHeader({ ticket, actor }: { ticket: SharedTicket; actor: SessionActor | null }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-zinc-100">{ticket.ticket_uid}</h1>
        <span className={`text-xs px-2 py-1 rounded border font-medium ${STATUS_COLORS[ticket.status] ?? STATUS_COLOR_FALLBACK}`}>
          {STATUS_LABELS[ticket.status] ?? ticket.status}
        </span>
      </div>
      <h2 className="text-sm text-zinc-300 mb-1">{ticket.title}</h2>
      {ticket.project_name && (
        <p className="text-xs text-zinc-500">Project: {ticket.project_name}</p>
      )}
      {actor && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1">
          <User className="w-3 h-3" />
          <span>Logged in as <span className="text-zinc-200">{actor.name}</span>{actor.company ? ` · ${actor.company}` : ''}</span>
        </div>
      )}
    </div>
  );
}
