/**
 * ForceCorrectBatchSteps — Compose, Preview, and Result step components for
 * the batch force-correct admin page. Extracted to keep the page under 300 lines.
 */

import { ForceCorrectFields } from './ForceCorrectFields';
import { ForceCorrectResultsTable } from './ForceCorrectResultsTable';
import type { ForceCorrectTarget, ForceCorrectResult } from '@/types/field-stock';

// ── Step 1: Compose ───────────────────────────────────────────────────────────

export function ComposeStep({
  serialsText, serialCount, target, reason, busy, canPreview,
  onSerialsChange, onTargetChange, onReasonChange, onPreview,
}: {
  serialsText: string;
  serialCount: number;
  target: ForceCorrectTarget;
  reason: string;
  busy: boolean;
  canPreview: boolean;
  onSerialsChange: (v: string) => void;
  onTargetChange: (v: ForceCorrectTarget) => void;
  onReasonChange: (v: string) => void;
  onPreview: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wide">
          Serial numbers (one per line)
        </label>
        <textarea
          value={serialsText}
          onChange={(e) => onSerialsChange(e.target.value)}
          rows={6}
          placeholder={'ABC123\nDEF456\nGHI789'}
          className="w-full rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] px-3 py-2 font-mono text-sm text-[var(--ff-text-primary)] resize-y focus:outline-none focus:ring-2 focus:ring-[var(--ff-border-focus)]"
        />
        <p className="text-right text-xs text-neutral-500">
          {serialCount} serial{serialCount !== 1 ? 's' : ''} entered
        </p>
      </div>
      <ForceCorrectFields
        value={target}
        reason={reason}
        onChange={onTargetChange}
        onReasonChange={onReasonChange}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onPreview}
          disabled={!canPreview}
          className="rounded-lg px-5 py-2.5 text-sm font-medium bg-[var(--ff-primary-600)] text-white hover:bg-[var(--ff-primary-700)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          {busy ? 'Loading preview…' : 'Preview changes →'}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Preview ───────────────────────────────────────────────────────────

export function PreviewStep({
  result, busy, onBack, onApply,
}: {
  result: ForceCorrectResult;
  busy: boolean;
  onBack: () => void;
  onApply: () => void;
}) {
  const notFound = result.rows.filter((r) => !r.found).length;
  const noOp = result.rows.filter((r) => r.found && !r.applied).length;
  const wouldChange = result.rows.filter((r) => r.applied).length;

  return (
    <div className="space-y-4">
      <SummaryBar
        requested={result.totalRequested}
        notFound={notFound}
        noOp={noOp}
        highlight={{ label: 'would change', count: wouldChange, color: 'text-amber-300' }}
      />
      <ForceCorrectResultsTable rows={result.rows} mode="preview" />
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-4 py-2 text-sm font-medium bg-[var(--ff-border-subtle)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-border-primary)] transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={busy || wouldChange === 0}
          className="rounded-lg px-5 py-2 text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          {busy ? 'Applying…' : `Apply to ${wouldChange} serial${wouldChange !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Result ────────────────────────────────────────────────────────────

export function ResultStep({ result, onReset }: { result: ForceCorrectResult; onReset: () => void }) {
  return (
    <div className="space-y-4">
      <SummaryBar
        requested={result.totalRequested}
        notFound={result.rows.filter((r) => !r.found).length}
        noOp={result.totalNoOp}
        highlight={{ label: 'applied', count: result.totalApplied, color: 'text-green-400' }}
      />
      <ForceCorrectResultsTable rows={result.rows} mode="result" />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg px-4 py-2 text-sm font-medium bg-[var(--ff-border-subtle)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-border-primary)] transition-colors"
        >
          Start over
        </button>
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────

export function SummaryBar({
  requested, notFound, noOp, highlight,
}: {
  requested: number;
  notFound: number;
  noOp: number;
  highlight: { label: string; count: number; color: string };
}) {
  return (
    <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--ff-border-primary)] bg-neutral-900/50 px-4 py-3 text-sm">
      <span><span className="font-medium">{requested}</span> requested</span>
      <span className="text-neutral-500">·</span>
      <span className="text-red-400"><span className="font-medium">{notFound}</span> not found</span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-400"><span className="font-medium">{noOp}</span> no-op</span>
      <span className="text-neutral-500">·</span>
      <span className={highlight.color}>
        <span className="font-medium">{highlight.count}</span> {highlight.label}
      </span>
    </div>
  );
}

export type BatchStep = 'compose' | 'preview' | 'result';

export function StepIndicator({ current }: { current: BatchStep }) {
  const steps: { key: BatchStep; label: string }[] = [
    { key: 'compose', label: '1. Compose' },
    { key: 'preview', label: '2. Preview' },
    { key: 'result', label: '3. Result' },
  ];
  return (
    <div className="mb-6 flex gap-2">
      {steps.map(({ key, label }) => (
        <span
          key={key}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            key === current
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-neutral-800 text-neutral-500 border border-neutral-700'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
