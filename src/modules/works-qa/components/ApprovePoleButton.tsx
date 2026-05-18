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
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const alreadyApproved = pole[APPROVED_FLAG[discipline]] === true;
  const { pass, blocking } = disciplineGatesPass(pole, discipline);
  const label = DISCIPLINE_LABEL[discipline];

  if (alreadyApproved) {
    return (
      <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
        <span>✓ {label} approved</span>
        {pole.overridden_by && (
          <span
            className="text-amber-400 text-[10px]"
            title={pole.override_reason ?? 'Approved with override'}
          >
            (override)
          </span>
        )}
      </div>
    );
  }

  async function postApprove(reason?: string) {
    setLoading(true);
    setError(null);
    try {
      const body: { pole_id: string; discipline: Discipline; override_reason?: string } =
        { pole_id: pole.id, discipline };
      if (reason) body.override_reason = reason;
      const res = await fetch('/api/works-qa/pole-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { success?: boolean; error?: string; blocking?: string[] };
      if (!res.ok) {
        setError(data.error ?? 'Approval failed');
        return;
      }
      setShowOverride(false);
      setOverrideReason('');
      onApproved();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          onClick={() => void postApprove()}
          disabled={!pass || loading}
          className="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-start"
        >
          {loading ? 'Approving…' : `Approve ${label}`}
        </button>
        {/* Force-approve escape hatch — only when the discipline gate would otherwise
            block. Same works-qa.approve permission gates the endpoint, so we trust
            the user can see it. Reason is required and persisted on the row. */}
        {!pass && !showOverride && (
          <button
            onClick={() => setShowOverride(true)}
            disabled={loading}
            className="text-[10px] text-amber-400 hover:text-amber-300 underline disabled:opacity-50"
            type="button"
          >
            Force approve
          </button>
        )}
      </div>
      {!pass && !showOverride && (
        <div className="text-[10px] text-zinc-500">
          Blocked: {blocking.slice(0, 3).join(', ')}{blocking.length > 3 ? ` +${blocking.length - 3} more` : ''}
        </div>
      )}
      {showOverride && (
        <div className="flex flex-col gap-1 mt-1 p-2 rounded bg-amber-500/5 border border-amber-500/40">
          <label className="text-[10px] text-amber-300 font-medium">
            Force approve {label} — reason (required, audited):
          </label>
          <input
            type="text"
            value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            maxLength={500}
            placeholder="e.g. photo unavailable, on-site sign-off by foreman"
            className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={() => void postApprove(overrideReason.trim())}
              disabled={loading || overrideReason.trim().length === 0}
              className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-2 py-1"
              type="button"
            >
              {loading ? 'Approving…' : 'Confirm override'}
            </button>
            <button
              onClick={() => { setShowOverride(false); setOverrideReason(''); }}
              disabled={loading}
              className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
