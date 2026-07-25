'use client';

/**
 * One-time reveal of a freshly minted read-only FibreFlow MCP token.
 *
 * Presentation-only — minting, listing and clipboard state live in
 * FibreFlowConnectPanel. The token is never persisted or logged here; it lives in the
 * parent's React state for the life of the page and is gone on reload.
 */

interface FibreFlowTokenRevealProps {
  token: string;
  /** Expiry as returned by the API (ISO); empty string when unknown. */
  expiresAt: string;
  copied: boolean;
  onCopy: () => void;
}

function formatExpiry(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FibreFlowTokenReveal({
  token,
  expiresAt,
  copied,
  onCopy,
}: FibreFlowTokenRevealProps) {
  const expiry = formatExpiry(expiresAt);
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-border border-l-2 border-l-warning-500 bg-background p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Copy this now</span> — it will not be
        shown again. It acts as a password: anyone holding it can read FibreFlow as you until
        it expires.
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
          onClick={onCopy}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
