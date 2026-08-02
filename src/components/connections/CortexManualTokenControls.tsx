'use client';

import type { CortexMcpLifetime } from '@/lib/cortex/mcpLifetimePolicy';

const LIFETIME_OPTIONS: ReadonlyArray<{ value: CortexMcpLifetime; label: string }> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'never', label: 'Never expires' },
];

interface CortexManualTokenControlsProps {
  busy: boolean;
  copied: boolean;
  error: string | null;
  expiresAt: string | null;
  lifetime: CortexMcpLifetime;
  minting: boolean;
  token: string | null;
  onCopy: () => void;
  onGenerate: () => void;
  onLifetimeChange: (lifetime: CortexMcpLifetime) => void;
}

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CortexManualTokenControls({
  busy,
  copied,
  error,
  expiresAt,
  lifetime,
  minting,
  token,
  onCopy,
  onGenerate,
  onLifetimeChange,
}: CortexManualTokenControlsProps) {
  const expiry = expiresAt ? formatExpiry(expiresAt) : '';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--ff-text-secondary)]">
        Browser sign-in is the normal setup. Use a manual token only for a client that cannot
        complete browser consent.
      </p>
      <div className="rounded-md border border-l-2 border-l-warning-500 border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] p-3 text-sm text-[var(--ff-text-secondary)]">
        This token acts as a password. Anyone holding it can read Cortex as you within your
        approved access.
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-[var(--ff-text-secondary)]">
          <span className="font-medium text-[var(--ff-text-primary)]">Cortex token lifetime</span>
          <select
            value={lifetime}
            onChange={(event) => onLifetimeChange(event.target.value as CortexMcpLifetime)}
            disabled={busy}
            className="rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] px-3 py-2 text-[var(--ff-text-primary)] disabled:opacity-50"
          >
            {LIFETIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {minting ? 'Generating…' : 'Generate Cortex token'}
        </button>
      </div>
      {lifetime === 'never' && (
        <p className="text-sm text-warning-600">This token does not expire until you revoke it.</p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {token && (
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-l-2 border-l-warning-500 border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] p-3 text-xs text-[var(--ff-text-secondary)]">
            <span className="font-medium text-[var(--ff-text-primary)]">Copy this now</span> — it will not be shown again.
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--ff-text-primary)]">Your token</span>
            <span className="text-[11px] text-[var(--ff-text-secondary)]">
              {expiresAt === null ? 'Does not expire — revoke it manually' : expiry ? `Expires ${expiry}` : ''}
            </span>
          </div>
          <div className="flex gap-2">
            <input type="text" aria-label="Cortex MCP token" readOnly value={token} className="min-w-0 flex-1 rounded-md border border-[var(--ff-border-primary)] bg-[var(--ff-background-primary)] px-2 py-1.5 font-mono text-xs text-[var(--ff-text-primary)]" />
            <button type="button" onClick={onCopy} className="rounded-md border border-[var(--ff-border-primary)] px-3 py-1.5 text-xs font-medium text-[var(--ff-text-primary)] transition-colors hover:bg-[var(--ff-background-secondary)]">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
