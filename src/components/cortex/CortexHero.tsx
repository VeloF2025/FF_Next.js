'use client';

import { useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('CortexHero');

/**
 * Premium hero band for the /cortex page — mirrors the Cortex landing
 * (velocity.cortexhq.xyz): gold eyebrow → aperture-"C" wordmark → tagline →
 * three glass stat cards. The CONTROL card shows the live pending-review count
 * via its own lightweight GET /api/cortex-review (decoupled from the review
 * panel's fetch; the list is cheap). Styling lives in styles/cortex-premium.css.
 */
export function CortexHero() {
  // null = still loading / unknown; we never block the hero on this fetch.
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/cortex-review', { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: unknown };
        if (Array.isArray(json.data)) setPending(json.data.length);
      } catch (err) {
        // AbortError on unmount is expected and ignored. A real failure just leaves the
        // count unknown (the card falls back to "Human review gates") — it's decorative
        // and never surfaced to the user, but we still record it for diagnostics.
        if (err instanceof Error && err.name !== 'AbortError') {
          log.warn('pending-review count fetch failed', { error: err.message });
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const controlValue =
    pending === null
      ? 'Human review gates'
      : pending === 0
        ? 'All clear'
        : `${pending} pending review`;
  // null (loading/unknown) → neutral; >0 → gold (needs attention); 0 → green (clear).
  // Never show green while the count is still unknown — the dot must not claim "all clear".
  const controlDot =
    pending === null ? 'cx-dot--neutral' : pending > 0 ? 'cx-dot--gold' : 'cx-dot--green';

  return (
    <header className="cx-hero">
      <span className="cx-eyebrow">Enterprise AI Operations Layer</span>
      {/* aria-label gives the heading its real name — the "C" is decorative raster art
          (alt="") and the visible text is only "ortex", so without this it would
          announce as "ortex" to screen readers. */}
      <h1 className="cx-hero-wordmark" aria-label="Cortex">
        <img src="/cortex-brand/cortex-aperture-c-hero-trimmed.png" alt="" aria-hidden="true" />
        <span>ortex</span>
      </h1>
      <p className="cx-hero-copy">
        Secure organisational memory, agentic workflows, and human-reviewed
        operational intelligence — every answer source-attributed and ACL-scoped to you.
      </p>

      <dl className="cx-stats">
        <div className="cx-glass cx-stat">
          <dt>Tenant model</dt>
          <dd>Schema isolated</dd>
        </div>
        <div className="cx-glass cx-stat">
          <dt>Sources</dt>
          <dd>Comms · docs · meetings</dd>
        </div>
        <div className="cx-glass cx-stat">
          <dt>Control</dt>
          <dd>
            <span className={`cx-dot ${controlDot}`} aria-hidden="true" />
            {controlValue}
          </dd>
        </div>
      </dl>
    </header>
  );
}
