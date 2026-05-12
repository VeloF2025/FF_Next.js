import { useState } from 'react';
import { allGatesPass } from '../utils/approval-gates';
import type { PoleQaPhoto } from '../types/works-qa.types';

interface ApprovePoleButtonProps {
  pole: PoleQaPhoto;
  onApproved: () => void;
}

export function ApprovePoleButton({ pole, onApproved }: ApprovePoleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { pass, blocking } = allGatesPass(pole);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/works-qa/pole-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: pole.id }),
      });
      const data = await res.json() as { success?: boolean; error?: string; blocking?: string[] };
      if (!res.ok) {
        setError(data.error ?? 'Approval failed');
      } else {
        onApproved();
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  if (pole.approved_at) {
    return (
      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
        <span>✓ Approved</span>
        <span className="text-zinc-500 text-xs">
          by {pole.approved_by} at {new Date(pole.approved_at).toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleApprove}
        disabled={!pass || loading}
        className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Approving…' : 'Approve Pole'}
      </button>

      {!pass && (
        <div className="text-xs text-zinc-500">
          Blocked: {blocking.slice(0, 3).join(', ')}{blocking.length > 3 ? ` +${blocking.length - 3} more` : ''}
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
