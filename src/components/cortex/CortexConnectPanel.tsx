'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lifetime } from '@/lib/cortex/bridgeAuth';
import { McpTokenReveal, type CopyTarget } from './McpTokenReveal';

/**
 * "Connect to Claude (MCP)" — self-serve panel that mints a user-selectable-lifetime
 * (30 days / 90 days / 1 year, default 90 days) Cortex MCP bearer token for the
 * signed-in user (POST /api/cortex/mcp-token) and shows the MCP client config to
 * paste it into.
 *
 * The token is a bearer credential (anyone holding it queries Cortex AS this user
 * until it expires), so it is shown ONCE, never persisted client-side, and never
 * logged. The server reads the identity from the verified session — this component
 * supplies no email. To revoke, use the Revoke control (Phase 7 PR-D).
 */

/** The endpoint's phase gate (ALLOWED_LIFETIMES in pages/api/cortex/mcp-token.ts)
 *  excludes `never`, so the UI derives its narrower union from the lib's type. */
type UiLifetime = Exclude<Lifetime, 'never'>;

const LIFETIME_OPTIONS: ReadonlyArray<{ value: UiLifetime; label: string }> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
];

interface MintResponse {
  data?: { token?: string; expiresAt?: string | null };
  error?: { message?: string };
}

const BRIDGE_URL = ['https:', '', 'app.fibreflow.app', 'api', 'cortex-bridge'].join('/');

/** The MCP client config snippet (mirrors docs/cortex-mcp-connect.md), token inlined. */
function configSnippet(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        cortex: {
          command: 'uv',
          args: ['run', '--directory', '/path/to/Cortex', '--package', 'cortex-mcp', 'cortex-mcp'],
          env: { CORTEX_USER_TOKEN: token, CORTEX_BRIDGE_URL: BRIDGE_URL },
        },
      },
    },
    null,
    2,
  );
}

function formatExpiry(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CortexConnectPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [lifetime, setLifetime] = useState<UiLifetime>('90d');
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the "Copied!" timer on unmount so we never setState on an unmounted node.
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setCopied(null);
    try {
      const res = await fetch('/api/cortex/mcp-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifetime }),
      });
      const json = (await res.json().catch(() => null)) as MintResponse | null;
      if (!res.ok) {
        // Surface the server's reason (e.g. the super-admin 90-day cap) when given.
        throw new Error(json?.error?.message ?? `request failed (${res.status})`);
      }
      const t = json?.data?.token;
      if (!t) throw new Error('no token returned');
      setToken(t);
      setExpiresAt(json?.data?.expiresAt ?? '');
    } catch (e) {
      setToken(null);
      setError(`Could not generate a token: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [lifetime]);

  const revoke = useCallback(async () => {
    setRevoking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/cortex/mcp-token', { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      // Every previously minted MCP token now 401s at the bridge.
      setToken(null);
      setExpiresAt('');
      setNotice('All your MCP tokens have been revoked. Generate a new one to reconnect.');
    } catch (e) {
      setError(`Could not revoke: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRevoking(false);
    }
  }, []);

  const copy = useCallback(async (text: string, which: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Copy failed — select the text and copy manually.');
    }
  }, []);

  const expiry = formatExpiry(expiresAt);
  // Computed once per render (and memoized across renders) — the token-in-snippet
  // contract is then auditable in one place and JSON.stringify runs at most once.
  const snippet = useMemo(() => (token ? configSnippet(token) : ''), [token]);

  return (
    <div className="cx-glass flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-0.5">
        <span className="cx-eyebrow">MCP Access</span>
        <span className="text-base font-semibold text-foreground">Connect to Claude (MCP)</span>
        <span className="text-xs text-muted-foreground">
          Generate a personal token to query Cortex from Claude (or any MCP client). Results
          are narrowed to what you&apos;re allowed to see.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Token lifetime</span>
          <select
            value={lifetime}
            onChange={(e) => setLifetime(e.target.value as UiLifetime)}
            disabled={loading || revoking}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            {LIFETIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading || revoking}
          className="cx-btn-gold rounded-md px-4 py-1.5 text-sm"
        >
          {loading ? 'Generating…' : token ? 'Regenerate token' : 'Generate token'}
        </button>
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={loading || revoking}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {revoking ? 'Revoking…' : 'Revoke my MCP access'}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

      {token && (
        <McpTokenReveal
          token={token}
          expiry={expiry}
          snippet={snippet}
          copied={copied}
          onCopy={(text, which) => void copy(text, which)}
        />
      )}
    </div>
  );
}
