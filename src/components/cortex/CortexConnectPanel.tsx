'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * "Connect to Claude (MCP)" — self-serve panel that mints a 30-day Cortex MCP
 * bearer token for the signed-in user (POST /api/cortex/mcp-token) and shows the
 * MCP client config to paste it into.
 *
 * The token is a bearer credential (anyone holding it queries Cortex AS this user
 * until it expires), so it is shown ONCE, never persisted client-side, and never
 * logged. The server reads the identity from the verified session — this component
 * supplies no email. To revoke, use the Revoke control (Phase 7 PR-D).
 */

interface MintResponse {
  data?: { token?: string; expiresAt?: string };
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
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function CortexConnectPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'config' | null>(null);
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
      const res = await fetch('/api/cortex/mcp-token', { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as MintResponse;
      const t = json.data?.token;
      if (!t) throw new Error('no token returned');
      setToken(t);
      setExpiresAt(json.data?.expiresAt ?? '');
    } catch (e) {
      setToken(null);
      setError(`Could not generate a token: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const copy = useCallback(async (text: string, which: 'token' | 'config') => {
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
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border border-l-2 border-l-warning-500 bg-background p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Copy this token now</span> — it&apos;s shown
            only once and acts as a password (anyone holding it can query Cortex as you until it
            expires). Don&apos;t commit it or paste it in chat/tickets.
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Your token</span>
              {expiry && (
                <span className="text-[11px] text-muted-foreground">Expires {expiry}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                readOnly
                value={token}
                aria-label="Cortex MCP token"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => void copy(token, 'token')}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                {copied === 'token' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">MCP client config</span>
              <button
                type="button"
                onClick={() => void copy(snippet, 'config')}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                {copied === 'config' ? 'Copied!' : 'Copy config'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {snippet}
            </pre>
            <span className="text-[11px] text-muted-foreground">
              Paste into your Claude Desktop / Claude Code MCP settings. See the
              <span className="font-mono"> docs/cortex-mcp-connect.md</span> guide for details.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
