'use client';

/**
 * One-time reveal of a freshly minted Cortex MCP token: handle-with-care warning,
 * the token itself (password-masked, copyable), and the MCP client config snippet.
 *
 * Presentation-only — minting, revocation and clipboard state live in
 * CortexConnectPanel; the token is never persisted or logged here.
 */

export type CopyTarget = 'token' | 'config';

interface McpTokenRevealProps {
  token: string;
  /** Pre-formatted expiry date for display; empty string when unknown/never. */
  expiry: string;
  /** The MCP client config JSON with the token inlined. */
  snippet: string;
  copied: CopyTarget | null;
  onCopy: (text: string, which: CopyTarget) => void;
}

export function McpTokenReveal({ token, expiry, snippet, copied, onCopy }: McpTokenRevealProps) {
  return (
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
            onClick={() => onCopy(token, 'token')}
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
            onClick={() => onCopy(snippet, 'config')}
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
  );
}
