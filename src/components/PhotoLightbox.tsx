/**
 * PhotoLightbox — Shared full-screen photo viewer with zoom, pan, and navigation.
 *
 * Generic: accepts a pre-built URL + optional metadata string, so it works with
 * any photo source (Firebase, proxy endpoints, MinIO, etc.).
 *
 * Keyboard: Escape=close, ArrowLeft/Right=navigate, +/-=zoom, 0=reset.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LightboxPhoto {
  /** Direct photo URL — used as-is in the <img> src. */
  url: string;
  /** Filename or display name shown in the top bar. */
  label: string | null;
  /** Optional one-liner in the bottom bar (VLM feedback, serial number, etc.). */
  metadata?: string;
}

export interface PhotoLightboxProps {
  photos: LightboxPhoto[];
  initialIndex: number;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

// Shared style for nav arrow buttons overlaid on the photo area.
const NAV_BTN = 'absolute top-1/2 -translate-y-1/2 p-3 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhotoLightbox({ photos, initialIndex, onClose }: PhotoLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const photo = photos[currentIndex];
  if (!photo) return null;

  // -- Zoom / pan --

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const zoomIn = useCallback(() => setZoom(p => Math.min(p + ZOOM_STEP, MAX_ZOOM)), []);

  const zoomOut = useCallback(() => {
    setZoom(p => { const n = Math.max(p - ZOOM_STEP, MIN_ZOOM); if (n === MIN_ZOOM) setPan({ x: 0, y: 0 }); return n; });
  }, []);

  // -- Navigation --

  const goPrev = useCallback(() => {
    if (currentIndex > 0) { setCurrentIndex(i => i - 1); resetView(); }
  }, [currentIndex, resetView]);

  const goNext = useCallback(() => {
    if (currentIndex < photos.length - 1) { setCurrentIndex(i => i + 1); resetView(); }
  }, [currentIndex, photos.length, resetView]);

  // -- Keyboard --

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-') zoomOut();
      else if (e.key === '0') resetView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, onClose, zoomIn, zoomOut, resetView]);

  // -- Mouse wheel zoom --

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const d = ZOOM_STEP * 0.5;
    if (e.deltaY < 0) {
      setZoom(p => Math.min(p + d, MAX_ZOOM));
    } else {
      setZoom(p => { const n = Math.max(p - d, MIN_ZOOM); if (n === MIN_ZOOM) setPan({ x: 0, y: 0 }); return n; });
    }
  }, []);

  // -- Click-drag pan --

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= MIN_ZOOM) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= MIN_ZOOM) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  // Backdrop click closes — guards against accidental close after drag.
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current && !isDragging) onClose();
  };

  // -- Render --

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" role="dialog" aria-label="Photo viewer">

      {/* Top bar: label, counter, zoom controls, close */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-gray-800">
        <div className="text-sm text-gray-300 truncate max-w-[60%]">
          <span className="font-medium text-white">{photo.label ?? 'Photo'}</span>
          <span className="ml-3 text-gray-500">{currentIndex + 1} / {photos.length}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={zoomOut} disabled={zoom <= MIN_ZOOM} title="Zoom out (-)"
            className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
            <ZoomOut className="w-5 h-5" />
          </button>

          <span className="text-xs text-gray-400 w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>

          <button onClick={zoomIn} disabled={zoom >= MAX_ZOOM} title="Zoom in (+)"
            className="p-2 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
            <ZoomIn className="w-5 h-5" />
          </button>

          <button onClick={resetView} title="Reset zoom (0)"
            className="p-2 text-gray-400 hover:text-white transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-gray-700 mx-1" />

          <button onClick={onClose} title="Close (Esc)"
            className="p-2 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Photo area with zoom / pan / nav arrows */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center select-none"
        onClick={handleBackdropClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
        style={{ cursor: zoom > MIN_ZOOM ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <img
          src={photo.url}
          alt={photo.label ?? 'Photo'}
          className="max-w-full max-h-full object-contain transition-transform duration-150"
          style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
          draggable={false}
        />

        {currentIndex > 0 && (
          <button onClick={goPrev} className={`${NAV_BTN} left-4`} aria-label="Previous photo">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {currentIndex < photos.length - 1 && (
          <button onClick={goNext} className={`${NAV_BTN} right-4`} aria-label="Next photo">
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Bottom info bar — only shown when metadata is provided */}
      {photo.metadata && (
        <div className="px-4 py-2 bg-black/50 border-t border-gray-800">
          <p className="text-xs text-gray-400">{photo.metadata}</p>
        </div>
      )}
    </div>
  );
}
