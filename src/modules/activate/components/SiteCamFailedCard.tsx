import { CheckCircle, XCircle } from 'lucide-react';

export interface AttemptPhoto {
  attempt: number;
  url: string;
  reasons: string[];
}

export interface Escalation {
  id: string;
  job_type: 'activations' | 'civils';
  site_id: string;
  step_number: number;
  tech_name: string | null;
  fail_reasons: string[];
  attempt_photos: AttemptPhoto[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall Mount', 6: 'ONT Back After Install',
  7: 'Power Meter', 8: 'Final Installation', 9: 'Green Lights',
  10: 'Signature', 11: 'Dome Joint Open', 12: 'Dome Joint Closed',
};

interface SiteCamFailedCardProps {
  escalation: Escalation;
  note: string;
  resolving: boolean;
  onNoteChange: (v: string) => void;
  onResolve: (resolution: 'approved' | 'rejected') => void;
}

export function SiteCamFailedCard({
  escalation: e,
  note,
  resolving,
  onNoteChange,
  onResolve,
}: SiteCamFailedCardProps) {
  return (
    <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
      {e.fail_reasons.length > 0 && (
        <p className="text-sm text-neutral-700">{e.fail_reasons.join('; ')}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {e.attempt_photos.map((p) => (
          <figure key={p.attempt} className="space-y-1">
            <img
              src={p.url}
              alt={`Attempt ${p.attempt}`}
              className="h-40 w-full rounded-lg object-contain border border-neutral-200 bg-neutral-50"
            />
            <figcaption className="text-xs text-neutral-500">
              Attempt {p.attempt}: {p.reasons.join(', ')}
            </figcaption>
          </figure>
        ))}
      </div>

      {e.status === 'pending' ? (
        <div className="space-y-3">
          <textarea
            value={note}
            onChange={(ev) => onNoteChange(ev.target.value)}
            placeholder="Note (required if rejecting)…"
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
          />
          <div className="flex gap-3">
            <button
              type="button"
              disabled={resolving}
              onClick={() => onResolve('approved')}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" /> Approve
            </button>
            <button
              type="button"
              disabled={resolving || !note.trim()}
              onClick={() => onResolve('rejected')}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" /> Reject
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          {e.status === 'approved' ? 'Approved' : 'Rejected'} by {e.resolved_by_name ?? 'unknown'}
          {e.resolution_note ? ` — ${e.resolution_note}` : ''}
        </p>
      )}
    </div>
  );
}
