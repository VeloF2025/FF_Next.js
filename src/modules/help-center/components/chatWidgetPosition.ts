/**
 * Pure position maths for the floating chat widget button.
 *
 * Kept out of ChatWidget.tsx so that file exports only its component:
 * exporting helpers beside a component trips react-refresh/only-export-components
 * and breaks fast refresh for the whole module.
 *
 * `x` is a left offset and `y` a bottom offset, both CSS pixels, matching the
 * `style={{ left, bottom }}` the button is rendered with.
 */

/** Rendered diameter of the floating button. */
export const BTN_SIZE = 56;
/** Gap between the button and the viewport edge for the default parking spot. */
export const EDGE_GAP = 24;
/** Minimum on-screen margin; the button must never be fully outside the viewport. */
export const MIN_EDGE = 4;
/**
 * Stored-position schema version. v1 had no marker and defaulted to the
 * bottom-LEFT corner; v2 defaults bottom-right and records this field.
 *
 * The version exists so the one-time re-park does not have to GUESS from the
 * coordinates. Treating a stored {24,24} as "never dragged" is wrong for any
 * user who deliberately dragged the button to that near-corner spot — their
 * choice would be silently overwritten with no way to tell the two apart.
 * A v2 record is always honoured, whatever its coordinates.
 */
export const STORAGE_VERSION = 2;
/** The v1 bottom-left default, only ever compared against UNVERSIONED records. */
export const LEGACY_DEFAULT_OFFSET = 24;

export interface WidgetPosition { x: number; y: number }

/**
 * Clamps a position so the button stays reachable in a viewport of the given
 * size.
 *
 * This must be applied to RESTORED positions, not only to live drags. A
 * position dragged to the right edge of a 2560px desktop and restored on a
 * 390px phone puts the button ~2.1k px off-screen — and because dragging it
 * back requires grabbing the button first, the widget becomes permanently
 * unreachable for that user. Drag-time clamping cannot prevent this: the
 * viewport that invalidates the value is a later one.
 *
 * A viewport smaller than the button collapses to MIN_EDGE rather than
 * producing an upper bound below the lower bound.
 */
export function clampToViewport(
  pos: WidgetPosition,
  viewportWidth: number,
  viewportHeight: number,
): WidgetPosition {
  const maxX = Math.max(MIN_EDGE, viewportWidth - BTN_SIZE - MIN_EDGE);
  const maxY = Math.max(MIN_EDGE, viewportHeight - BTN_SIZE - MIN_EDGE);
  return {
    x: Math.min(maxX, Math.max(MIN_EDGE, pos.x)),
    y: Math.min(maxY, Math.max(MIN_EDGE, pos.y)),
  };
}

/**
 * Should a stored record's coordinates be restored as-is?
 *
 * Versioned (v2+) records always win — the user's drag is authoritative.
 * Unversioned v1 records sitting exactly on the old bottom-left default are
 * the only ones re-parked, because for those the coordinates are the sole
 * available signal and that exact pair is overwhelmingly "never touched".
 */
export function keepStoredPosition(stored: { x: number; y: number; v?: number }): boolean {
  if (typeof stored.v === 'number' && stored.v >= STORAGE_VERSION) return true;
  return !(stored.x === LEGACY_DEFAULT_OFFSET && stored.y === LEGACY_DEFAULT_OFFSET);
}

/** Bottom-right parking spot, clamped so it is valid on a very short viewport too. */
export function defaultPosition(viewportWidth: number, viewportHeight: number): WidgetPosition {
  return clampToViewport(
    { x: viewportWidth - BTN_SIZE - EDGE_GAP, y: EDGE_GAP },
    viewportWidth,
    viewportHeight,
  );
}
