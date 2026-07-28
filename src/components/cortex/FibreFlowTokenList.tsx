'use client';

/**
 * The signed-in user's active read-only FibreFlow MCP tokens.
 *
 * Presentation-only — fetching, minting and revocation live in FibreFlowConnectPanel.
 * Never renders credential material: the API returns metadata only, and the token
 * value itself is shown once at mint time and never again.
 */

export interface McpTokenRow {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

interface FibreFlowTokenListProps {
  tokens: McpTokenRow[];
  onRevoke: (id: string) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FibreFlowTokenList({ tokens, onRevoke }: FibreFlowTokenListProps) {
  if (tokens.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">You have no active read-only tokens.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Label</th>
            <th className="py-1.5 pr-3 font-medium">Created</th>
            <th className="py-1.5 pr-3 font-medium">Last used</th>
            <th className="py-1.5 pr-3 font-medium">Expires</th>
            <th className="py-1.5 font-medium" />
          </tr>
        </thead>
        <tbody className="text-foreground">
          {tokens.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="py-1.5 pr-3">{t.label ?? '—'}</td>
              <td className="py-1.5 pr-3">{formatDate(t.createdAt)}</td>
              <td className="py-1.5 pr-3">{formatDate(t.lastUsedAt)}</td>
              <td className="py-1.5 pr-3">{formatDate(t.expiresAt)}</td>
              <td className="py-1.5">
                <button
                  type="button"
                  onClick={() => onRevoke(t.id)}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
