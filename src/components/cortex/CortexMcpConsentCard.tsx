'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import type { CortexMcpConsentContext } from '@/lib/cortex/mcpConsentContext';

export type CortexMcpConsentPhase =
  | 'checking'
  | 'ready'
  | 'submitting'
  | 'redirecting'
  | 'cancelled'
  | 'error';

interface CortexMcpConsentCardProps {
  phase: CortexMcpConsentPhase;
  error: string | null;
  email: string | null;
  context: CortexMcpConsentContext | null;
  onAllow: () => void;
  onCancel: () => void;
}

const SHELL =
  'w-full max-w-md rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-7 shadow-lg';

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={SHELL}>
      <h1 className="text-lg font-semibold text-[var(--ff-text-primary)]">{title}</h1>
      <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">{children}</p>
      <Link
        href="/connections/cortex"
        className="mt-5 inline-block text-sm text-[var(--ff-primary-500)] hover:underline"
      >
        Go to Cortex connections
      </Link>
    </div>
  );
}

export function CortexMcpConsentCard({
  phase,
  error,
  email,
  context,
  onAllow,
  onCancel,
}: CortexMcpConsentCardProps) {
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

  if (!context) {
    return (
      <Notice title="Could not authorize">
        Authorization details could not be verified. Return to Claude and try
        connecting again.
      </Notice>
    );
  }

  const busy = phase === 'submitting' || phase === 'redirecting';

  return (
    <div className={SHELL}>
      <h1 className="text-lg font-semibold text-[var(--ff-text-primary)]">
        Allow Cortex Knowledge access?
      </h1>
      <p className="mt-3 text-sm text-[var(--ff-text-secondary)]">
        The connector identified below can search meetings, email, WhatsApp,
        SharePoint, timelines and cited evidence that your Cortex access permits. It
        cannot add, change, approve or delete anything.
      </p>
      <ul className="mt-4 space-y-1.5 text-sm text-[var(--ff-text-secondary)]">
        <li>· Read-only Cortex tools</li>
        <li>· Full or limited scope is decided by your verified FibreFlow email</li>
        <li>· The connector never displays or asks you to paste a bearer token</li>
      </ul>
      <div className="mt-5 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-3">
        <div>
          <p className="text-xs text-[var(--ff-text-tertiary)]">
            Application name — provided by the connector, not verified
          </p>
          <p className="break-all text-sm font-medium text-[var(--ff-text-primary)]">
            {context.clientName || 'Unnamed connector'}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-tertiary)]">
            Destination that receives the authorization result
          </p>
          <code className="block break-all text-xs text-[var(--ff-text-primary)]">
            {context.redirectUri}
          </code>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-tertiary)]">Requested scopes</p>
          <code className="block break-all text-xs text-[var(--ff-text-primary)]">
            {context.scopes.length ? context.scopes.join(', ') : 'No scopes declared'}
          </code>
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] px-3 py-2">
        <p className="text-xs text-[var(--ff-text-tertiary)]">Signed in as</p>
        <p className="text-sm font-medium text-[var(--ff-text-primary)]">
          {email ?? 'your FibreFlow account'}
        </p>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button variant="primary" onClick={onAllow} loading={busy} disabled={busy}>
          {phase === 'redirecting' ? 'Returning to connector…' : 'Allow'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
