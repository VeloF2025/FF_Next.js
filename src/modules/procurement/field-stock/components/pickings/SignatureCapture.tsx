/**
 * SignatureCapture Component
 * Digital signature capture for equipment allocation forms (SOP 4.1)
 */

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Pen, Check, X, RotateCcw } from 'lucide-react';

interface SignatureCaptureProps {
  onSave: (signatureData: string, signedBy: string) => void;
  onCancel?: () => void;
  signerName?: string;
  width?: number;
  height?: number;
}

export function SignatureCapture({
  onSave,
  onCancel,
  signerName = '',
  width = 400,
  height = 200
}: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [name, setName] = useState(signerName);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Configure drawing style
    ctx.strokeStyle = '#1f2937'; // gray-800
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }, [width, height]);

  // Get coordinates from event
  const getCoordinates = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      // Touch event
      const touch = e.touches[0];
      if (!touch) return null;
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY
      };
    } else {
      // Mouse event
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }
  }, []);

  // Start drawing
  const handleStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords) return;

    setIsDrawing(true);
    setLastPoint(coords);
    setHasSignature(true);
  }, [getCoordinates]);

  // Draw on canvas
  const handleMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || !lastPoint) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const coords = getCoordinates(e);
    if (!coords) return;

    // Draw line
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    setLastPoint(coords);
  }, [isDrawing, lastPoint, getCoordinates]);

  // Stop drawing
  const handleEnd = useCallback(() => {
    setIsDrawing(false);
    setLastPoint(null);
  }, []);

  // Clear canvas
  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }, []);

  // Save signature
  const handleSave = useCallback(() => {
    if (!hasSignature || !name.trim()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Convert canvas to base64
    const signatureData = canvas.toDataURL('image/png');
    onSave(signatureData, name.trim());
  }, [hasSignature, name, onSave]);

  return (
    <div className="space-y-4">
      {/* Signer Name Input */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          Full Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your full name..."
          className="w-full rounded-lg border border-border bg-card py-2 px-3 text-foreground placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
        />
      </div>

      {/* Signature Canvas */}
      <div>
        <label className="mb-1 block text-sm font-medium text-muted-foreground">
          Signature
        </label>
        <div className="relative rounded-lg border-2 border-dashed border-border bg-white dark:border-gray-600">
          <canvas
            ref={canvasRef}
            className="touch-none cursor-crosshair rounded-lg"
            style={{ width: '100%', height: `${height}px` }}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
          />

          {/* Draw hint overlay */}
          {!hasSignature && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-400">
                <Pen className="h-5 w-5" />
                <span className="text-sm">Sign here</span>
              </div>
            </div>
          )}

          {/* Clear button */}
          {hasSignature && (
            <button
              onClick={handleClear}
              className="absolute right-2 top-2 rounded-lg bg-secondary p-1.5 text-muted-foreground hover:bg-secondary hover:text-gray-700 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              title="Clear signature"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Use your finger or mouse to sign above
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!hasSignature || !name.trim()}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          Confirm & Sign
        </button>
      </div>
    </div>
  );
}
