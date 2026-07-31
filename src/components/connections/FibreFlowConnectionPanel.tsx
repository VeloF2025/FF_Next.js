'use client';

import { useCallback, useEffect, useState } from 'react';
import { FibreFlowTokenList, type McpTokenRow } from './FibreFlowTokenList';
import { ConnectorSetupCard } from './ConnectorSetupCard';
import { ManualTokenControls, type UiLifetime } from './ManualTokenControls';

/**
 * Browser-consent setup plus existing self-serve session management.
 *
 * `sessionsEnabled` mirrors the server's FF_MCP_TOKEN_UI_ENABLED gate. The
 * /api/me/mcp-tokens routes 404 when that flag is off, so the sessions list and
 * Advanced minting must stay hidden — otherwise every user on an environment
 * without the flag sees a "could not load your tokens" error for a feature that
 * is deliberately switched off.
 */

const FIBREFLOW_MCP_ENDPOINT =
  'https://app.fibreflow.app/api/ff-remote-mcp/mcp';

interface ListResponse {
  data?: { tokens?: McpTokenRow[] };
  error?: { message?: string };
}

interface MintResponse {
  data?: { token?: string; expiresAt?: string | null };
  error?: { message?: string };
}

interface FibreFlowConnectionPanelProps {
  sessionsEnabled?: boolean;
}

export function FibreFlowConnectionPanel({
  sessionsEnabled = false,
}: FibreFlowConnectionPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [lifetime, setLifetime] = useState<UiLifetime>('30d');
  const [label, setLabel] = useState('');
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionsEnabled) return;
    setSessionError(null);
    try {
      const res = await fetch('/api/me/mcp-tokens');
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      setTokens(json?.data?.tokens ?? []);
    } catch (e) {
      setSessionError(`Could not load your tokens: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [sessionsEnabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = useCallback(async () => {
    setLoading(true);
    setManualError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/me/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifetime, label: label.trim() || undefined }),
      });
      const json = (await res.json().catch(() => null)) as MintResponse | null;
      if (!res.ok) {
        // Surface the server's reason (e.g. the owner 90-day cap) when given.
        throw new Error(json?.error?.message ?? `request failed (${res.status})`);
      }
      const t = json?.data?.token;
      if (!t) throw new Error('no token returned');
      setToken(t);
      setExpiresAt(json?.data?.expiresAt ?? '');
      setLabel('');
      await refresh();
    } catch (e) {
      setToken(null);
      setManualError(`Could not generate a token: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [lifetime, label, refresh]);

  const revoke = useCallback(
    async (id: string) => {
      setSessionError(null);
      try {
        const encodedId = encodeURIComponent(id);
        const res = await fetch(`/api/me/mcp-tokens/${encodedId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`${res.status}`);
        await refresh();
      } catch (e) {
        setSessionError(`Could not revoke: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refresh]
  );

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
        heading="FibreFlow Operations"
        description="Connect Claude to the projects, QField, fleet and procurement data your FibreFlow RBAC access allows. The connector is read-only and cannot change operational records."
        endpoint={FIBREFLOW_MCP_ENDPOINT}
        consentDescription="The browser window verifies your FibreFlow identity and applies the same RBAC access you have in the app."
      />

      {sessionsEnabled && (
        <>
          <section className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Active sessions</h2>
            <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
              Review or revoke the connector sessions associated with your account.
            </p>
            {sessionError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {sessionError}
              </p>
            )}
            <div className="mt-4">
              <FibreFlowTokenList tokens={tokens} onRevoke={(id) => void revoke(id)} />
            </div>
          </section>

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
              <ManualTokenControls
                copied={copied}
                error={manualError}
                expiresAt={expiresAt}
                label={label}
                lifetime={lifetime}
                loading={loading}
                token={token}
                onCopy={() => void copyToken()}
                onGenerate={() => void generate()}
                onLabelChange={setLabel}
                onLifetimeChange={setLifetime}
              />
            )}
          </details>
        </>
      )}
    </div>
  );
}
