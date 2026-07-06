import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { log } from '@/lib/logger';
import { SiteCamFailedQueue } from './SiteCamFailedQueue';
import { AiBadge, VlmRecommendationPanel, type VlmAdvisory } from './AppealVlmPanel';

interface Appeal extends VlmAdvisory {
  id: string;
  dr_number: string;
  step_number: number;
  appeal_text: string;
  photo_url: string;
  serial_scanned: string | null;
  serial_expected: string | null;
  attempt_number: number;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  tech_name: string | null;
  denial_reason: string | null;
  human_agreed_with_vlm: boolean | null;
}

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall Mount', 6: 'ONT Back After Install',
  7: 'Power Meter', 8: 'Final Installation', 9: 'Green Lights',
  10: 'Signature', 11: 'Dome Joint Open', 12: 'Dome Joint Closed',
};

const MODULE = 'SiteCamAppealsQueue';

export function SiteCamAppealsQueue() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'denied' | 'failed'>('pending');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [denialText, setDenialText] = useState('');

  const load = useCallback(async (status: 'pending' | 'approved' | 'denied') => {
    setLoading(true);
    try {
      const r = await fetch(`/api/activate/sitecam-appeals?status=${status}`, { credentials: 'include' });
      const j = (await r.json()) as { data: { appeals: Appeal[] } };
      setAppeals(j.data.appeals);
    } catch (err) {
      log.error('Load appeals failed', { err: String(err) }, MODULE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'failed') void load(tab);
  }, [tab, load]);

  async function decide(id: string, decision: 'approved' | 'denied') {
    setDeciding(id);
    try {
      const res = await fetch(`/api/activate/sitecam-appeals/${id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, denialReason: decision === 'denied' ? denialText : undefined }),
      });
      if (!res.ok) {
        log.error('Decision rejected', { id, status: res.status }, MODULE);
        return;
      }
      setDenialText('');
      setExpanded(null);
      await load(tab === 'failed' ? 'pending' : tab);
    } catch (err) {
      log.error('Decision failed', { err: String(err) }, MODULE);
    } finally {
      setDeciding(null);
    }
  }

  const tabs: Array<'pending' | 'approved' | 'denied' | 'failed'> = ['pending', 'approved', 'denied', 'failed'];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-neutral-200 pb-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize rounded-t ${
              tab === t ? 'border-b-2 border-sky-600 text-sky-700' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'failed' ? (
        <SiteCamFailedQueue />
      ) : (
        <>
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          )}

          {!loading && appeals.length === 0 && (
            <p className="py-10 text-center text-sm text-neutral-400">No {tab} appeals</p>
          )}

          <div className="space-y-2">
            {appeals.map((a) => (
              <div key={a.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                >
                  <div>
                    <span className="font-medium text-sky-700 underline-offset-2 hover:underline">{a.dr_number}</span>
                    <span className="mx-2 text-neutral-400">·</span>
                    <span className="text-sm text-neutral-600">
                      Step {a.step_number}: {STEP_LABELS[a.step_number] ?? ''}
                    </span>
                    <span className="mx-2 text-neutral-400">·</span>
                    <span className="text-xs text-neutral-500">{a.tech_name ?? 'Unknown'}</span>
                    <AiBadge advisory={a} />
                    {a.status !== 'pending' && a.human_agreed_with_vlm !== null && (
                      <span className={`ml-2 text-xs ${a.human_agreed_with_vlm ? 'text-green-600' : 'text-amber-600'}`}>
                        {a.human_agreed_with_vlm ? '✓ agreed' : '✗ disagreed'}
                      </span>
                    )}
                  </div>
                  {expanded === a.id
                    ? <ChevronUp className="h-4 w-4 text-neutral-400" />
                    : <ChevronDown className="h-4 w-4 text-neutral-400" />}
                </button>

                {expanded === a.id && (
                  <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
                    <p className="text-sm text-neutral-700">{a.appeal_text}</p>
                    <VlmRecommendationPanel advisory={a} />
                    {a.serial_scanned && (
                      <div className="text-xs text-neutral-500 space-y-1">
                        <p>Serial scanned: <span className="font-mono">{a.serial_scanned}</span></p>
                        <p>Expected: <span className="font-mono">{a.serial_expected ?? 'unknown'}</span></p>
                      </div>
                    )}
                    <img
                      src={a.photo_url}
                      alt="Appeal photo"
                      className="h-48 w-full rounded-lg object-contain border border-neutral-200 bg-neutral-50"
                    />
                    {tab === 'pending' && (
                      <div className="space-y-3">
                        <textarea
                          value={denialText}
                          onChange={(e) => setDenialText(e.target.value)}
                          placeholder="Denial reason (required if denying)…"
                          rows={2}
                          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
                        />
                        <div className="flex gap-3">
                          <button
                            type="button"
                            disabled={deciding === a.id}
                            onClick={() => void decide(a.id, 'approved')}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
                          >
                            <CheckCircle className="h-4 w-4" /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={deciding === a.id || !denialText.trim()}
                            onClick={() => void decide(a.id, 'denied')}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                          >
                            <XCircle className="h-4 w-4" /> Deny
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
