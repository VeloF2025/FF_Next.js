// Advisory VLM recommendation UI for the SiteCam appeals queue (shadow mode).
// Extracted from SiteCamAppealsQueue.tsx to keep that component under the
// 200-line limit. Renders the at-a-glance badge and the expanded reasoning panel.

export interface AppealCheck {
  name: string;
  verdict: 'pass' | 'fail' | 'uncertain';
  evidence: string;
}

/** The advisory VLM fields an appeal row carries (mirrors the vlm_* columns). */
export interface VlmAdvisory {
  vlm_recommendation: 'approve' | 'deny' | 'uncertain' | null;
  vlm_confidence: number | null;
  vlm_reasoning: string | null;
  vlm_checks: AppealCheck[] | null;
  vlm_serial_read: string | null;
  vlm_skip_reason: string | null;
}

const REC_STYLES: Record<'approve' | 'deny' | 'uncertain', string> = {
  approve: 'bg-green-100 text-green-700',
  deny: 'bg-red-100 text-red-700',
  uncertain: 'bg-neutral-100 text-[var(--ff-text-tertiary)]',
};

export function AiBadge({ advisory }: { advisory: VlmAdvisory }) {
  const rec = advisory.vlm_recommendation;
  if (!rec) return null;
  const pct = advisory.vlm_confidence != null ? ` ${Math.round(advisory.vlm_confidence * 100)}%` : '';
  const label = rec === 'uncertain' ? 'AI: Uncertain' : `AI: ${rec === 'approve' ? 'Approve' : 'Deny'}${pct}`;
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${REC_STYLES[rec]}`}>
      {label}
    </span>
  );
}

export function VlmRecommendationPanel({ advisory }: { advisory: VlmAdvisory }) {
  if (!advisory.vlm_recommendation) return null;
  return (
    <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--ff-text-secondary)]">
        <span>VLM recommendation</span>
        <AiBadge advisory={advisory} />
        {advisory.vlm_skip_reason && <span className="text-[var(--ff-text-tertiary)]">({advisory.vlm_skip_reason})</span>}
      </div>
      {advisory.vlm_reasoning && <p className="text-sm text-[var(--ff-text-primary)]">{advisory.vlm_reasoning}</p>}
      {advisory.vlm_serial_read && (
        <p className="text-xs text-[var(--ff-text-tertiary)]">Serial read: <span className="font-mono">{advisory.vlm_serial_read}</span></p>
      )}
      {advisory.vlm_checks && advisory.vlm_checks.length > 0 && (
        <ul className="space-y-1">
          {advisory.vlm_checks.map((c) => (
            <li key={c.name} className="text-xs text-[var(--ff-text-tertiary)]">
              <span className={c.verdict === 'pass' ? 'text-green-600' : c.verdict === 'fail' ? 'text-red-600' : 'text-[var(--ff-text-tertiary)]'}>
                {c.verdict}
              </span>{' '}
              <span className="font-medium">{c.name}</span> — {c.evidence}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
