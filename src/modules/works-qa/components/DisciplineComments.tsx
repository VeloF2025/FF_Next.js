import { useState } from 'react';
import { log } from '@/lib/logger';
import type { Discipline } from '../utils/approval-gates';
import type { PoleQaComment } from '../types/works-qa.types';

interface DisciplineCommentsProps {
  poleId: string;
  discipline: Discipline;
  comments: PoleQaComment[];
  disabled?: boolean;
  onAdded: () => void;
}

function relativeTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
}

export function DisciplineComments({ poleId, discipline, comments, disabled, onAdded }: DisciplineCommentsProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = comments.filter(c => c.discipline === discipline);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/works-qa/pole-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: poleId, discipline, comment: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setText('');
      onAdded();
    } catch (e: unknown) {
      log.error('works-qa: comment submit failed', { error: e instanceof Error ? e.message : String(e) });
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {thread.length > 0 && (
        <ul className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
          {thread.map(c => (
            <li key={c.id} className="text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
                <span>{c.created_by}</span>
                <span>{relativeTime(c.created_at)}</span>
              </div>
              <p className="text-zinc-200 whitespace-pre-wrap leading-snug">{c.comment}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          disabled={disabled || submitting}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-600 resize-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          {error ? <span className="text-[10px] text-red-400">{error}</span> : <span />}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!text.trim() || submitting || disabled}
            className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Posting…' : 'Add comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
