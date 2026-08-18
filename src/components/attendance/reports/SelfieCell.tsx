/**
 * Selfie cell for a Pulse report table.
 *
 * Renders a button, not a link: the selfie resolves through the audited API
 * route which returns JSON, so it has to be fetched and unwrapped before the
 * image can be opened. See `openAuditedSelfie`. Each cell owns its own error
 * state so one failed lookup doesn't blank the whole table.
 */

import { useState } from 'react';

import { openAuditedSelfie, parseSelfieHref } from '../openAuditedSelfie';

export function SelfieCell({ href, context }: { href: string; context: string }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const target = parseSelfieHref(href);

  if (!target) return <span className="text-neutral-600">—</span>;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => {
          setError(null);
          setLoading(true);
          void openAuditedSelfie(target.entryId, target.kind, context, setError)
            .finally(() => setLoading(false));
        }}
        className="text-emerald-400 hover:text-emerald-300 underline disabled:opacity-50"
      >
        {loading ? 'Opening…' : 'View'}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </span>
  );
}
