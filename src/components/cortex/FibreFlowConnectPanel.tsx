'use client';

import { useCallback, useEffect, useState } from 'react';
import { FibreFlowTokenList, type McpTokenRow } from './FibreFlowTokenList';

/**
 * "FibreFlow (read-only)" — self-serve panel that mints a long-lived, READ-ONLY
 * FibreFlow bearer token for the signed-in user (POST /api/me/mcp-tokens) so an MCP
 * client can call FibreFlow's own HTTP API as them.
 *
 * Distinct from CortexConnectPanel, which mints a token for the Cortex bridge. This
 * one authenticates against FibreFlow itself; the server refuses every mutating
 * request made with it (src/lib/auth/readOnly.ts). Lives beside the Cortex panel so it
 * inherits the connections page's scoped `cx-*` skin.
 *
 * The token is a bearer credential, so it is shown ONCE, never persisted client-side
 * and never logged.
 */

const LIFETIME_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
] as const;

type UiLifetime = (typeof LIFETIME_OPTIONS)[number]['value'];

interface ListResponse {
  data?: { tokens?: McpTokenRow[]; ownerCapped?: boolean; ownerMaxDays?: number };
  error?: { message?: string };
}

interface MintResponse {
  data?: { token?: string; expiresAt?: string | null };
  error?: { message?: string };
}

const MAX_LABEL_LENGTH = 60;

function formatExpiry(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FibreFlowConnectPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [lifetime, setLifetime] = useState<UiLifetime>('30d');
  const [label, setLabel] = useState('');
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [ownerCapped, setOwnerCapped] = useState(false);
  const [ownerMaxDays, setOwnerMaxDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me/mcp-tokens');
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      setTokens(json?.data?.tokens ?? []);
      setOwnerCapped(json?.data?.ownerCapped ?? false);
      setOwnerMaxDays(json?.data?.ownerMaxDays ?? 90);
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

  const expiry = formatExpiry(expiresAt);

  return (
    <div className="cx-glass flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-0.5">
        <span className="cx-eyebrow">MCP Access</span>
        <span className="text-base font-semibold text-foreground">FibreFlow (read-only)</span>
        <span className="text-xs text-muted-foreground">
          Gives Claude read-only access to FibreFlow as you — the same projects, meetings and
          data you can see in the app, and nothing more. It cannot change anything.
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Token lifetime</span>
          <select
            value={lifetime}
            onChange={(e) => setLifetime(e.target.value as UiLifetime)}
            disabled={loading}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            {LIFETIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Label</span>
          <input
            type="text"
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="Claude desktop"
            onChange={(e) => setLabel(e.target.value)}
            disabled={loading}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="cx-btn-gold rounded-md px-4 py-1.5 text-sm"
        >
          {loading ? 'Generating…' : 'Generate token'}
        </button>
      </div>

      {ownerCapped && (
        <p className="text-[11px] text-muted-foreground">
          Owner tokens are capped at {ownerMaxDays} days.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {token && (
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border border-l-2 border-l-warning-500 bg-background p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Copy this now</span> — it will not be
            shown again. It acts as a password: anyone holding it can read FibreFlow as you
            until it expires.
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Your token</span>
            {expiry && <span className="text-[11px] text-muted-foreground">Expires {expiry}</span>}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={token}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
            />
            <button
              type="button"
              onClick={() => void copyToken()}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <FibreFlowTokenList tokens={tokens} onRevoke={(id) => void revoke(id)} />
    </div>
  );
}
