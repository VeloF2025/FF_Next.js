'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * The consent card rendered by pages/mcp/authorize.tsx.
 *
 * Presentation only — every decision (auth, state_id validity, minting) belongs to the
 * page and the API. Kept separate so the page stays a thin controller and both files
 * stay well inside the file-size limits.
 */

export type McpConsentPhase =
  | 'checking'
  | 'ready'
  | 'submitting'
  | 'redirecting'
  | 'cancelled'
  | 'error';

interface McpConsentCardProps {
  phase: McpConsentPhase;
  error: string | null;
  email: string | null;
  onAllow: () => void;
  onCancel: () => void;
}

// Card surface uses --ff-bg-secondary against an --ff-bg-primary page, matching the
// convention in dashboard.tsx/dr-review.tsx. Not --ff-bg-card: that variable is only
// declared in the dark block, so a light-theme card would render with no background.
const SHELL =
  'w-full max-w-md rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-7 shadow-lg';

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={SHELL}>
      <h1 className="text-lg font-semibold text-[var(--ff-text-primary)]">{title}</h1>
      <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">{children}</p>
      <Link
        href="/dashboard"
        className="mt-5 inline-block text-sm text-[var(--ff-primary-500)] hover:underline"
      >
        Go to FibreFlow
      </Link>
    </div>
  );
}

export function McpConsentCard({ phase, error, email, onAllow, onCancel }: McpConsentCardProps) {
  if (phase === 'checking') {
    return (
      <div className={SHELL}>
        <p className="text-sm text-[var(--ff-text-secondary)]">Loading…</p>
      </div>
    );
  }

  if (phase === 'cancelled') {
    return (
      <Notice title="Authorization cancelled">
        Nothing was shared and no access was granted. You can close this tab.
      </Notice>
    );
  }

  if (phase === 'error') {
    return (
      <Notice title="Could not authorize">
        {error ?? 'Something went wrong. Return to Claude and try connecting again.'}
      </Notice>
    );
  }

  const busy = phase === 'submitting' || phase === 'redirecting';

  return (
    <div className={SHELL}>
      <h1 className="text-lg font-semibold text-[var(--ff-text-primary)]">
        Allow Claude to read FibreFlow as you?
      </h1>

      <p className="mt-3 text-sm text-[var(--ff-text-secondary)]">
        Claude will see the same projects, meetings and data you can see in the app — and
        nothing more. It cannot change anything. You can revoke this at any time from the
        Cortex page.
      </p>

      <ul className="mt-4 space-y-1.5 text-sm text-[var(--ff-text-secondary)]">
        <li>· Read-only — Claude cannot create, edit or delete anything</li>
        <li>· Your permissions — never more than your own access</li>
        <li>· Revocable — remove it from the Cortex page whenever you like</li>
      </ul>

      <div className="mt-5 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2">
        <p className="text-xs text-[var(--ff-text-tertiary)]">Signed in as</p>
        <p className="text-sm font-medium text-[var(--ff-text-primary)]">
          {email ?? 'your FibreFlow account'}
        </p>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="primary" onClick={onAllow} loading={busy} disabled={busy}>
          {phase === 'redirecting' ? 'Returning to Claude…' : 'Allow'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
