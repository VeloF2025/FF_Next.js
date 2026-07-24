/**
 * Drawn-signature capture (goal §4.5 — drawn variant for appointment letters).
 *
 * A plain canvas with pointer drawing; exports the mark as a PNG data URL. No
 * third-party service and no external library — the signer's mark never leaves
 * the browser except as the data URL the caller chooses to submit.
 */

import { useRef, useState, useEffect } from 'react';
import { Eraser, PenLine } from 'lucide-react';

interface Props {
  onCapture: (dataUrl: string) => void;
  busy?: boolean;
}

export function SignaturePad({ onCapture, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    // Correct for CSS size vs the canvas's intrinsic buffer size — the canvas
    // is 400×140 but styled w-full, so on a narrow viewport the two differ and
    // an uncorrected stroke drifts from the pointer.
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setDirty(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
  }

  function capture() {
    if (!dirty) return;
    onCapture(canvasRef.current!.toDataURL('image/png'));
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={400}
        height={140}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="border border-[var(--ff-border-light)] rounded-lg bg-white touch-none w-full max-w-[400px] cursor-crosshair"
      />
      <div className="flex gap-2">
        <button type="button" onClick={clear} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)]">
          <Eraser className="w-4 h-4" /> Clear
        </button>
        <button type="button" onClick={capture} disabled={busy || !dirty} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] disabled:opacity-50 text-white rounded-lg">
          <PenLine className="w-4 h-4" /> {busy ? 'Signing…' : 'Sign & save'}
        </button>
      </div>
    </div>
  );
}
