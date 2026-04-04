/**
 * PhotoLightbox — Full-screen photo viewer with zoom and navigation
 *
 * Features:
 *   - Click photo to open full-screen overlay
 *   - Zoom in/out with buttons and mouse wheel
 *   - Pan when zoomed in (click-drag)
 *   - Navigate between photos with arrows
 *   - Close with X, Escape, or click backdrop
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LightboxPhoto {
  id: string;
  storage_key: string;
  source: string;
  filename: string | null;
  vlm_confidence: number | null;
  vlm_feedback: string | null;
}

interface Props {
  photos: LightboxPhoto[];
  initialIndex: number;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

export function PhotoLightbox({ photos, initialIndex, onClose }: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgFailed, setImgFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const photo = photos[currentIndex];
  if (!photo) return null;

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgFailed(false);
  };

  const goNext = useCallback(() => {
    if (currentIndex < photos.length - 1) {
      setCurrentIndex(prev => prev + 1);
      resetView();
    }
  }, [currentIndex, photos.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      resetView();
    }
  }, [currentIndex]);

  const zoomIn = () => setZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  const zoomOut = () => {
    setZoom(prev => {
      const next = Math.max(prev - ZOOM_STEP, MIN_ZOOM);
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
      if (e.key === '0') resetView();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, onClose]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setZoom(prev => Math.min(prev + ZOOM_STEP * 0.5, MAX_ZOOM));
    } else {
      setZoom(prev => {
        const next = Math.max(prev - ZOOM_STEP * 0.5, MIN_ZOOM);
        if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
        return next;
      });
    }
  }, []);

  // Pan with drag
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Backdrop click to close (only if not dragging)
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === containerRef.current && !isDragging) {
      onClose();
    }
  };

  const photoUrl = `/api/construction-qa/photo-proxy?key=${encodeURIComponent(photo.storage_key)}&source=${photo.source}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      role="dialog"
      aria-label="Photo viewer"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-gray-800">
        <div className="text-sm text-gray-300">
          <span className="font-medium text-white">{photo.filename || 'Photo'}</span>
          <span className="ml-3 text-gray-500">
            {currentIndex + 1} / {photos.length}
          </span>
          {photo.vlm_confidence != null && (
            <span className={`ml-3 font-mono ${
              photo.vlm_confidence >= 0.8 ? 'text-green-400' :
              photo.vlm_confidence >= 0.6 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              AI: {Math.round(photo.vlm_confidence * 100)}%
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <Button variant="ghost" size="icon" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} title="Zoom out (-)">
            <ZoomOut className="w-5 h-5" />
          </Button>
          <span className="text-xs text-gray-400 w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} title="Zoom in (+)">
            <ZoomIn className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={resetView} title="Reset zoom (0)">
            <RotateCcw className="w-4 h-4" />
          </Button>

          <div className="w-px h-6 bg-gray-700 mx-1" />

          {/* Close */}
          <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Photo Area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center select-none"
        onClick={handleBackdropClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {imgFailed ? (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
            <ImageOff className="w-16 h-16 text-gray-600" />
            <p className="text-sm">Photo not yet synced from QField</p>
            <p className="text-xs text-gray-600">{photo.filename}</p>
          </div>
        ) : (
          <img
            src={photoUrl}
            alt={photo.filename || 'Photo'}
            className="max-w-full max-h-full object-contain transition-transform duration-150"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            }}
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        )}

        {/* Prev arrow */}
        {currentIndex > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 rounded-full text-white hover:bg-black/80"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>
        )}

        {/* Next arrow */}
        {currentIndex < photos.length - 1 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 rounded-full text-white hover:bg-black/80"
            aria-label="Next photo"
          >
            <ChevronRight className="w-6 h-6" />
          </Button>
        )}
      </div>

      {/* Bottom Info Bar */}
      {photo.vlm_feedback && (
        <div className="px-4 py-2 bg-black/50 border-t border-gray-800">
          <p className="text-xs text-gray-400">{photo.vlm_feedback}</p>
        </div>
      )}
    </div>
  );
}
