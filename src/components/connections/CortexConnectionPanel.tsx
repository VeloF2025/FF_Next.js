'use client';

import { useCallback, useState } from 'react';
import { ConnectorSetupCard } from './ConnectorSetupCard';

/**
 * Cortex connector setup, plus a revoke control.
 *
 * Cortex bearers are stateless 90-day JWTs, so revocation is the only way to
 * cut off a credential before it expires. `revokeEnabled` mirrors the server's
 * CORTEX_MCP_TOKEN_UI_ENABLED gate — DELETE /api/cortex/mcp-token 404s when the
 * flag is off, so the control stays hidden rather than offering a button that
 * cannot work.
 */

const CORTEX_MCP_ENDPOINT =
  'https://app.fibreflow.app/api/cortex-remote-mcp/mcp';

interface CortexConnectionPanelProps {
  revokeEnabled?: boolean;
}

export function CortexConnectionPanel({
  revokeEnabled = false,
}: CortexConnectionPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/cortex/mcp-token', { method: 'DELETE' });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      setNotice('All your Cortex tokens have been revoked. Reconnect the connector to continue.');
    } catch (e) {
      setError(`Could not revoke: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <ConnectorSetupCard
        heading="Cortex Knowledge"
        description="Search meetings, email, WhatsApp, SharePoint, timelines and cited evidence allowed by your Cortex access. The connector is read-only and cannot add, change, approve or delete anything."
        endpoint={CORTEX_MCP_ENDPOINT}
        consentDescription="The browser window verifies your FibreFlow identity and applies your approved Cortex scope without asking you to handle credentials."
      />

      {revokeEnabled && (
        <details
          open={advancedOpen}
          className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-6 shadow-sm"
        >
          <summary
            className="cursor-pointer font-medium text-[var(--ff-text-primary)]"
            onClick={(event) => {
              event.preventDefault();
              setAdvancedOpen((open) => !open);
            }}
          >
            Advanced
          </summary>
          {advancedOpen && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Revoking signs every Cortex connector session out of your account
                immediately. Use this if a device or token may have been exposed.
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => void revoke()}
                  disabled={busy}
                  className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-white disabled:opacity-50"
                >
                  {busy ? 'Revoking…' : 'Revoke all Cortex tokens'}
                </button>
              </div>
              {notice && (
                <p role="status" className="text-sm text-[var(--ff-text-secondary)]">
                  {notice}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </details>
      )}
    </div>
  );
}
