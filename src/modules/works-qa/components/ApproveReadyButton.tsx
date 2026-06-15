import { useState } from 'react';
import { log } from '@/lib/logger';
import type { Discipline } from '../utils/slot-keys';

// Inline overview approve. Only rendered for 'ready' poles — a ready pole has all
// slots filled with zero un-overridden VLM failures, so every per-discipline gate
// will pass. We still reuse the gated /pole-approve endpoint (one call each) and,
// on any non-OK response (e.g. a snag raised since render), hand off to the detail
// panel where the per-discipline / force-approve UX lives — never a silent no-op.
const DISCIPLINES: Discipline[] = ['civil', 'dome', 'main_joint'];

interface Props {
  poleId: string;
  onApproved: () => void;
  onNeedsDetail: () => void;
}

export function ApproveReadyButton({ poleId, onApproved, onNeedsDetail }: Props) {
  const [loading, setLoading] = useState(false);

  async function approveAll(e: React.MouseEvent) {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      for (const discipline of DISCIPLINES) {
        const res = await fetch('/api/works-qa/pole-approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pole_id: poleId, discipline }),
        });
        if (!res.ok) {
          log.error('works-qa: inline approve gate failed', { poleId, discipline, status: res.status });
          onNeedsDetail();
          return;
        }
      }
      onApproved();
    } catch (err) {
      log.error('works-qa: inline approve error', { poleId, error: err instanceof Error ? err.message : String(err) });
      onNeedsDetail();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void approveAll(e)}
      disabled={loading}
      className="text-[10px] px-2 py-0.5 rounded bg-teal-600 hover:bg-teal-500 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      title="Approve all disciplines for this pole"
    >
      {loading ? 'Approving…' : 'Approve ▸'}
    </button>
  );
}
