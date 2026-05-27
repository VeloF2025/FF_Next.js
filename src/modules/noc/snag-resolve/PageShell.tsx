/**
 * Layout primitives for the public /snag/resolve/[token] page.
 *
 * Kept off the dashboard chrome (no sidebar) — field workers open these
 * links from a WhatsApp share, often on small screens, and don't sign in.
 */

import type { ReactNode } from 'react';

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src="/assets/vf/vf-logo.svg" alt="FibreFlow" className="h-6" />
          <span className="text-sm font-medium text-zinc-300">Snag Resolution</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>

      <footer className="border-t border-zinc-800 mt-12">
        <div className="max-w-3xl mx-auto px-4 py-4 text-center">
          <p className="text-xs text-zinc-500">
            Powered by FibreFlow — Velocity Fibre (Pty) Ltd
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Renders snag description text with GPS coordinates as Google Maps links. */
export function DescriptionWithGPS({ text }: { text: string }) {
  const gpsRegex = /(GPS:\s*)?(-?\d{1,3}\.\d{3,10})\s*[,;]\s*(-?\d{1,3}\.\d{3,10})/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = gpsRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const lat = match[2];
    const lng = match[3];
    const label = match[0];
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    parts.push(
      <a
        key={match.index}
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
      >
        {label}
        <svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <p className="text-sm text-zinc-200 whitespace-pre-wrap">{parts}</p>;
}
