import { useState } from 'react';
import { disciplineGatesPass, type Discipline } from '../utils/approval-gates';
import type { PoleQaPhoto } from '../types/works-qa.types';

interface ApproveDisciplineButtonProps {
  pole: PoleQaPhoto;
  discipline: Discipline;
  onApproved: () => void;
}

const APPROVED_FLAG: Record<Discipline, keyof PoleQaPhoto> = {
  civil: 'civil_approved',
  dome: 'dome_approved',
  main_joint: 'joint_approved',  // legacy DB column name
};

const DISCIPLINE_LABEL: Record<Discipline, string> = {
  civil: 'Civil',
  dome: 'Optical Dome',
  main_joint: 'Main Joint',
};

export function ApproveDisciplineButton({ pole, discipline, onApproved }: ApproveDisciplineButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyApproved = pole[APPROVED_FLAG[discipline]] === true;
  const { pass, blocking } = disciplineGatesPass(pole, discipline);
  const label = DISCIPLINE_LABEL[discipline];

  if (alreadyApproved) {
    return (
      <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
        <span>✓ {label} approved</span>
      </div>
    );
  }

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/works-qa/pole-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: pole.id, discipline }),
      });
      const data = await res.json() as { success?: boolean; error?: string; blocking?: string[] };
      if (!res.ok) {
        setError(data.error ?? 'Approval failed');
        return;
      }
      onApproved();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => void handleApprove()}
        disabled={!pass || loading}
        className="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-start"
      >
        {loading ? 'Approving…' : `Approve ${label}`}
      </button>
      {!pass && (
        <div className="text-[10px] text-zinc-500">
          Blocked: {blocking.slice(0, 3).join(', ')}{blocking.length > 3 ? ` +${blocking.length - 3} more` : ''}
        </div>
      )}
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
