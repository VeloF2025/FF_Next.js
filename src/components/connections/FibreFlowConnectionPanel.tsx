'use client';

import { useCallback, useEffect, useState } from 'react';
import { FibreFlowTokenList, type McpTokenRow } from './FibreFlowTokenList';
import { FibreFlowTokenReveal } from './FibreFlowTokenReveal';
import { ConnectorSetupCard } from './ConnectorSetupCard';

/**
 * Browser-consent setup plus existing self-serve session management. Manual token
 * minting remains available under Advanced for legacy clients; freshly minted
 * credentials live only in React state and are shown once.
 */

const FIBREFLOW_MCP_ENDPOINT =
  'https://app.fibreflow.app/api/ff-remote-mcp/mcp';

const LIFETIME_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
] as const;

type UiLifetime = (typeof LIFETIME_OPTIONS)[number]['value'];

interface ListResponse {
  data?: { tokens?: McpTokenRow[] };
  error?: { message?: string };
}

interface MintResponse {
  data?: { token?: string; expiresAt?: string | null };
  error?: { message?: string };
}

const MAX_LABEL_LENGTH = 60;

interface ManualTokenControlsProps {
  copied: boolean;
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

function ManualTokenControls({
  copied,
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

export function FibreFlowConnectionPanel() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [lifetime, setLifetime] = useState<UiLifetime>('30d');
  const [label, setLabel] = useState('');
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me/mcp-tokens');
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      setTokens(json?.data?.tokens ?? []);
    } catch (e) {
      setError(`Could not load your tokens: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError(`Could not generate a token: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [lifetime, label, refresh]);

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/me/mcp-tokens/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`${res.status}`);
        await refresh();
      } catch (e) {
        setError(`Could not revoke: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refresh]
  );

  const copyToken = useCallback(async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError('Copy failed — select the text and copy manually.');
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

      <section className="rounded-xl border border-[var(--ff-border-primary)] bg-[var(--ff-surface-primary)] p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Active sessions</h2>
        <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
          Review or revoke the connector sessions associated with your account.
        </p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
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
    </div>
  );
}
