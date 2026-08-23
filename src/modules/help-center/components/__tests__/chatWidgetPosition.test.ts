import { describe, it, expect } from 'vitest';
import { clampToViewport, defaultPosition, keepStoredPosition } from '../chatWidgetPosition';

/**
 * The widget button is 56px, positioned `fixed` by a left offset (x) and a
 * bottom offset (y). If a restored position leaves it outside the viewport the
 * user cannot grab it to drag it back, so the widget is gone for good on that
 * device.
 */
const BTN = 56;
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 2560, h: 1440 };

describe('clampToViewport', () => {
  it('leaves an already-visible position untouched', () => {
    expect(clampToViewport({ x: 100, y: 100 }, PHONE.w, PHONE.h)).toEqual({ x: 100, y: 100 });
  });

  it('pulls a desktop-edge position back on screen when restored on a phone', () => {
    // The real failure: dragged to the right edge of a 2560px monitor, then the
    // same account opens the app on a 390px phone.
    const stored = { x: DESKTOP.w - BTN - 4, y: 24 }; // x = 2500
    const clamped = clampToViewport(stored, PHONE.w, PHONE.h);

    expect(clamped.x).toBeLessThanOrEqual(PHONE.w - BTN);
    // Fully visible, not merely "not negative".
    expect(clamped.x + BTN).toBeLessThanOrEqual(PHONE.w);
    expect(clamped.x).toBe(PHONE.w - BTN - 4);
  });

  it('clamps a vertical overflow the same way', () => {
    const clamped = clampToViewport({ x: 20, y: 5000 }, PHONE.w, PHONE.h);
    expect(clamped.y + BTN).toBeLessThanOrEqual(PHONE.h);
  });

  it('rejects negative offsets that would hide the button past the top-left', () => {
    expect(clampToViewport({ x: -400, y: -400 }, PHONE.w, PHONE.h)).toEqual({ x: 4, y: 4 });
  });

  it('never returns an upper bound below the lower bound on a tiny viewport', () => {
    // A viewport narrower than the button would make (width - BTN - 4) negative;
    // naive Math.min(maxX, Math.max(4, x)) would then return the negative value.
    const clamped = clampToViewport({ x: 200, y: 200 }, 40, 40);
    expect(clamped.x).toBeGreaterThanOrEqual(4);
    expect(clamped.y).toBeGreaterThanOrEqual(4);
  });
});

describe('keepStoredPosition', () => {
  it('honours a versioned record even at the old default coordinates', () => {
    // The whole point of the version marker: a user who deliberately dragged the
    // button to {24,24} under v2 keeps that choice. Sniffing the coordinates
    // alone cannot tell that apart from "never touched" and would discard it.
    expect(keepStoredPosition({ x: 24, y: 24, v: 2 })).toBe(true);
  });

  it('honours a versioned record at any other coordinates', () => {
    expect(keepStoredPosition({ x: 900, y: 300, v: 2 })).toBe(true);
  });

  it('re-parks an UNVERSIONED record sitting on the old bottom-left default', () => {
    expect(keepStoredPosition({ x: 24, y: 24 })).toBe(false);
  });

  it('honours an unversioned record the user clearly moved', () => {
    expect(keepStoredPosition({ x: 640, y: 120 })).toBe(true);
  });

  it('honours a record from a future schema version', () => {
    expect(keepStoredPosition({ x: 24, y: 24, v: 99 })).toBe(true);
  });
});

describe('defaultPosition', () => {
  it('parks bottom-right on a normal viewport', () => {
    const pos = defaultPosition(DESKTOP.w, DESKTOP.h);
    expect(pos.x).toBe(DESKTOP.w - BTN - 24);
    expect(pos.x).toBeGreaterThan(DESKTOP.w / 2);
  });

  it('stays inside a viewport too short to hold the button plus its gap', () => {
    // ~84px is enough: landscape phone with the keyboard open, split screen,
    // a small embedded iframe. A raw {y: EDGE_GAP} would sit partly off-screen
    // until some later resize event happened to correct it.
    const pos = defaultPosition(320, 70);
    expect(pos.y + BTN).toBeLessThanOrEqual(70);
    expect(pos.y).toBeGreaterThanOrEqual(4);
    expect(pos.x + BTN).toBeLessThanOrEqual(320);
  });
});
