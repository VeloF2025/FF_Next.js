/**
 * A labelled group of hub tiles.
 *
 * Lives in its own file because tiles.tsx is already 392 lines — past the
 * 300-line limit before this change touched anything — and adding to it would
 * make an existing violation worse.
 *
 * Renders nothing at all when every child is hidden — "Tools" disappears
 * entirely for a driver with neither Stores nor SiteCam, rather than leaving a
 * stranded heading.
 *
 * The mechanism is React's, not ours: callers pass `{cond && <Tile/>}`, which
 * yields `false`, and `Children.toArray` strips booleans, null and undefined.
 * Verified, because an earlier version of this file added a `.filter(Boolean)`
 * on the assumption it was needed — it was dead code. A raw `children.length`
 * WOULD be wrong here, which is what the test pins.
 */
import { Children, useId, type ReactNode } from 'react';

export function TileGroup({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  const visible = Children.toArray(children);
  if (visible.length === 0) return null;

  // aria-labelledby, so the section exposes as a NAMED region to a screen
  // reader rather than an anonymous one. Without it the heading is readable but
  // the landmark it introduces has no accessible name, which is worse than
  // having no landmark at all.
  return (
    <section className="mt-4 first:mt-0" aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-neutral-500"
      >
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-3">{visible}</div>
    </section>
  );
}
