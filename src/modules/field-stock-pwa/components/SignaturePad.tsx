'use client';

/**
 * SignaturePad — touch + mouse canvas signature capture.
 *
 * Standalone component, no third-party libraries. Uses the Pointer Events API
 * (PointerEvent) which unifies mouse and touch into a single event model.
 *
 * Canvas coordinates are corrected for CSS scaling via getBoundingClientRect()
 * and the canvas's logical vs rendered size ratio.
 *
 * Dark-theme conventions: bg-neutral-900, border-neutral-700, text-neutral-400.
 * Stroke colour is white (#fff) on a dark (#171717 = neutral-900) background
 * so signatures are legible in the dark UI.
 *
 * Props:
 *   value    — controlled data URL (null = empty / unsigned)
 *   onChange — called with the new data URL after each stroke, or null on clear
 */

// 🟢 WORKING: vanilla canvas, pointer events, dark theme

import { useRef, useEffect, useCallback } from 'react';
import { PenTool, Trash2 } from 'lucide-react';

export interface SignaturePadProps {
  /** Controlled value — the current signature as a PNG data URL, or null. */
  value: string | null;
  /** Called after each completed stroke or on clear. */
  onChange: (dataUrl: string | null) => void;
  /** Label above the pad. Defaults to the technician-facing wording. */
  label?: string;
  /** Hint shown while the pad is empty. */
  hint?: string;
}

// Dark background and stroke colours matching the /my portal dark theme.
const BG_COLOUR = '#171717'; // neutral-900
const STROKE_COLOUR = '#ffffff';
const LINE_WIDTH = 2.5;

export function SignaturePad({
  value,
  onChange,
  label = 'Technician signature',
  hint = 'Sign above to confirm receipt',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // Initialise canvas background on mount. We do NOT re-init on `value` changes
  // because the parent controls the data URL; the canvas itself is the source of
  // truth for pixels, and clearing is done through clearCanvas().
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = BG_COLOUR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = STROKE_COLOUR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  /** Convert a PointerEvent's client coords to canvas logical pixel coords. */
  const toCanvasCoords = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const coords = toCanvasCoords(e);
      if (!coords) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      drawing.current = true;
    },
    [toCanvasCoords],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      const coords = toCanvasCoords(e);
      if (!coords) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    },
    [toCanvasCoords],
  );

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      drawing.current = false;
      const canvas = canvasRef.current;
      if (!canvas) return;
      onChange(canvas.toDataURL('image/png'));
    },
    [onChange],
  );

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = BG_COLOUR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = STROKE_COLOUR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    onChange(null);
  }, [onChange]);

  return (
    <div className="space-y-2">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-300 flex items-center gap-1.5">
          <PenTool className="w-4 h-4 text-neutral-500" />
          {label}
        </span>
        <button
          type="button"
          onClick={clearCanvas}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-rose-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* Canvas */}
      <div className="rounded-lg overflow-hidden border border-neutral-700">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full min-h-[180px] touch-none cursor-crosshair bg-neutral-900"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {/* Hint when unsigned */}
      {!value && (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <PenTool className="w-3 h-3" />
          {hint}
        </p>
      )}
    </div>
  );
}
