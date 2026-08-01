'use client';

import { useCallback, useState } from 'react';
import type { CortexMcpLifetime } from '@/lib/cortex/mcpLifetimePolicy';
import { ConnectorSetupCard } from './ConnectorSetupCard';
import { CortexManualTokenControls } from './CortexManualTokenControls';

/**
 * Cortex connector setup, plus a revoke control.
 *
 * Cortex bearer lifetimes are selected per manual token; all remain revocable.
 * `revokeEnabled` mirrors the server's CORTEX_MCP_TOKEN_UI_ENABLED gate —
 * DELETE /api/cortex/mcp-token 404s when the flag is off, so the control stays
 * hidden rather than offering a button that cannot work.
 */

const CORTEX_MCP_ENDPOINT =
  'https://app.fibreflow.app/api/cortex-remote-mcp/mcp';

interface CortexConnectionPanelProps {
  revokeEnabled?: boolean;
}

interface MintResponse {
  data?: { token?: unknown; expiresAt?: unknown };
  error?: { message?: string };
}

export function CortexConnectionPanel({
  revokeEnabled = false,
}: CortexConnectionPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lifetime, setLifetime] = useState<CortexMcpLifetime>('30d');
  const [minting, setMinting] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const busy = minting || revoking;

  const generate = useCallback(async () => {
    setMinting(true);
    setToken(null);
    setExpiresAt(null);
    setCopied(false);
    setManualError(null);
    try {
      const res = await fetch('/api/cortex/mcp-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifetime }),
      });
      const json = (await res.json().catch(() => null)) as MintResponse | null;
      if (!res.ok) throw new Error(json?.error?.message ?? `request failed (${res.status})`);
      if (typeof json?.data?.token !== 'string' || !json.data.token) {
        throw new Error('no token returned');
      }
      if (typeof json.data.expiresAt !== 'string' && json.data.expiresAt !== null) {
        throw new Error('invalid expiry returned');
      }
      setToken(json.data.token);
      setExpiresAt(json.data.expiresAt);
    } catch (error) {
      setManualError(`Could not generate a token: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMinting(false);
    }
  }, [lifetime]);

  const revoke = useCallback(async () => {
    setRevoking(true);
    setNotice(null);
    setManualError(null);
    try {
      const res = await fetch('/api/cortex/mcp-token', { method: 'DELETE' });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      setToken(null);
      setExpiresAt(null);
      setCopied(false);
      setNotice('All your Cortex tokens have been revoked. Reconnect the connector to continue.');
    } catch (e) {
      setManualError(`Could not revoke: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRevoking(false);
    }
  }, []);

  const copyToken = useCallback(async () => {
    if (!token) return;
    setManualError(null);
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setManualError('Copy failed — select the text and copy manually.');
    }
  }, [token]);

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
            <div className="mt-4 flex flex-col gap-4">
              <CortexManualTokenControls
                busy={busy}
                copied={copied}
                error={manualError}
                expiresAt={expiresAt}
                lifetime={lifetime}
                minting={minting}
                token={token}
                onCopy={() => void copyToken()}
                onGenerate={() => void generate()}
                onLifetimeChange={setLifetime}
              />
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
                  {revoking ? 'Revoking…' : 'Revoke all Cortex tokens'}
                </button>
              </div>
              {notice && (
                <p role="status" className="text-sm text-[var(--ff-text-secondary)]">
                  {notice}
                </p>
              )}
            </div>
          )}
        </details>
      )}
    </div>
  );
}
