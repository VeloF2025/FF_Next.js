/** Pure formatters for Cortex citation rendering (shared by UI + tests). */

export interface CitationLike {
  source: string;
  channel: string;
  timestamp: string;
}

/** "source · channel · YYYY-MM-DD" — empty parts dropped, timestamp trimmed to day. */
export function citationMeta(c: CitationLike): string {
  const day = (c.timestamp || '').slice(0, 10);
  return [c.source, c.channel, day].filter(Boolean).join(' · ');
}
