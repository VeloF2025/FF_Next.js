'use client';

import { FibreFlowTokenReveal } from './FibreFlowTokenReveal';

/**
 * Manual bearer minting for legacy clients that cannot open browser consent.
 * Extracted from FibreFlowConnectionPanel to keep that component under the
 * 200-line cap; freshly minted credentials live only in React state.
 */

const LIFETIME_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
] as const;

export type UiLifetime = (typeof LIFETIME_OPTIONS)[number]['value'];

const MAX_LABEL_LENGTH = 60;

interface ManualTokenControlsProps {
  copied: boolean;
  error: string | null;
  expiresAt: string;
  label: string;
  lifetime: UiLifetime;
  loading: boolean;
  token: string | null;
  onCopy: () => void;
  onGenerate: () => void;
  onLabelChange: (label: string) => void;
  onLifetimeChange: (lifetime: UiLifetime) => void;
}

export function ManualTokenControls({
  copied,
  error,
  expiresAt,
  label,
  lifetime,
  loading,
  token,
  onCopy,
  onGenerate,
  onLabelChange,
  onLifetimeChange,
}: ManualTokenControlsProps) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-sm text-[var(--ff-text-secondary)]">
        For legacy clients that cannot open browser consent, create a read-only
        bearer token manually.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-[var(--ff-text-secondary)]">
          <span className="font-medium text-[var(--ff-text-primary)]">Token lifetime</span>
          <select
            value={lifetime}
            onChange={(event) => onLifetimeChange(event.target.value as UiLifetime)}
            disabled={loading}
            className="rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] px-3 py-2 text-[var(--ff-text-primary)] disabled:opacity-50"
          >
            {LIFETIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--ff-text-secondary)]">
          <span className="font-medium text-[var(--ff-text-primary)]">Label</span>
          <input
            type="text"
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="Claude desktop"
            onChange={(event) => onLabelChange(event.target.value)}
            disabled={loading}
            className="rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] px-3 py-2 text-[var(--ff-text-primary)] disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate token'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {token && (
        <FibreFlowTokenReveal
          token={token}
          expiresAt={expiresAt}
          copied={copied}
          onCopy={onCopy}
        />
      )}
    </div>
  );
}
