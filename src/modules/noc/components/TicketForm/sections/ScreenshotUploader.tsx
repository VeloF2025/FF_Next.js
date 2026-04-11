/**
 * ScreenshotUploader - Multi-media DevOps ticket creation
 *
 * Accepts screenshots, screen recordings, and voice memos.
 * AI analyses the media and auto-fills ticket fields.
 *
 * // WORKING: VLM + Whisper pipeline for DevOps tickets
 */

'use client';

import {
  Camera, Upload, CheckCircle, AlertCircle, X,
  Maximize2, Monitor, Video, Mic, FileVideo, FileAudio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { useScreenshotUploader } from './useScreenshotUploader';
import { ACCEPTED_TYPES, ANALYSING_MESSAGES } from './screenshotUtils';

interface ScreenshotUploaderProps {
  onFieldsExtracted: (fields: Record<string, string>) => void;
  onFileAdded?: (file: File) => void;
  onFileRemoved?: (index: number) => void;
  required?: boolean;
  validationError?: string;
  disabled?: boolean;
}

export function ScreenshotUploader({
  onFieldsExtracted,
  onFileAdded,
  onFileRemoved,
  required,
  validationError,
  disabled,
}: ScreenshotUploaderProps) {
  const {
    previews, isAnalysing, analysingType, isDragging, error,
    analysisComplete, successMessage, showLightbox,
    setShowLightbox, setError, fileInputRef,
    handleFileInput, handleDragOver, handleDragLeave, handleDrop, handlePaste, removePreview,
  } = useScreenshotUploader({ onFieldsExtracted, onFileAdded, onFileRemoved, disabled });

  const analysingMsg = ANALYSING_MESSAGES[analysingType];

  return (
    <div className="space-y-3">
      {/* Instructions banner */}
      <div className="flex items-start gap-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
        <Monitor className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-purple-300 flex items-center gap-2">
            AI-powered bug reporting
            {required && (
              <span className="text-[10px] uppercase tracking-wide font-semibold bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5 rounded">
                Required
              </span>
            )}
          </p>
          <p className="text-purple-300/70 mt-0.5">
            Press <kbd className="px-1.5 py-0.5 bg-purple-500/20 rounded text-xs font-mono">F12</kbd> to open DevTools,
            then capture the error. Upload a <strong>screenshot</strong>, <strong>screen recording</strong>, or <strong>voice memo</strong> —
            AI will extract and auto-fill all fields.
          </p>
        </div>
      </div>

      {/* Upload zone */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileInput}
        disabled={disabled || isAnalysing}
        className="hidden"
      />

      <div
        onClick={() => !disabled && !isAnalysing && fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={0}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50',
          isDragging
            ? 'border-purple-400 bg-purple-400/10 scale-[1.01]'
            : 'border-[var(--ff-border-light)] hover:border-purple-400/50 hover:bg-purple-500/5',
          (disabled || isAnalysing) && 'opacity-50 cursor-not-allowed',
          (error || validationError) && 'border-red-400/50'
        )}
      >
        {isAnalysing ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <InlineSpinner size="lg" className="text-purple-400" />
            <p className="text-sm font-medium text-purple-300">{analysingMsg.title}</p>
            <p className="text-xs text-[var(--ff-text-muted)]">{analysingMsg.subtitle}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="flex items-center gap-3">
              <Camera className="w-5 h-5 text-purple-400" />
              <Video className="w-5 h-5 text-blue-400" />
              <Mic className="w-5 h-5 text-green-400" />
            </div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              Drop screenshot, recording, or voice memo here
            </p>
            <p className="text-xs text-[var(--ff-text-muted)]">
              Paste <kbd className="px-1 py-0.5 bg-[var(--ff-bg-tertiary)] rounded text-xs font-mono">Ctrl+V</kbd>, drag & drop, or click to browse — AI auto-fills all fields
            </p>
          </div>
        )}
      </div>

      {/* Success banner */}
      {analysisComplete && (
        <div className="flex items-center gap-2 p-2.5 bg-green-500/10 border border-green-500/30 rounded-lg">
          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
          <span className="text-sm text-green-300">{successMessage}</span>
        </div>
      )}

      {/* Form-level validation error (e.g. "screenshot required for DevOps") */}
      {validationError && !error && previews.length === 0 && (
        <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-300">{validationError}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-300">{error}</span>
          <Button variant="ghost" size="icon" onClick={() => setError(null)} aria-label="Dismiss error" className="ml-auto">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Media previews */}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {previews.map((p, i) => (
            <div key={i} className="relative group w-24 h-24">
              {p.type === 'image' && p.dataUrl ? (
                <>
                  <img
                    src={p.dataUrl}
                    alt={p.name}
                    className="w-full h-full object-cover rounded-lg border border-[var(--ff-border-light)] cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setShowLightbox(p.dataUrl)}
                  />
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={() => setShowLightbox(p.dataUrl)}
                  >
                    <Maximize2 className="w-4 h-4 text-white" />
                  </div>
                </>
              ) : p.type === 'video' ? (
                <div className="w-full h-full rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] flex flex-col items-center justify-center gap-1 overflow-hidden">
                  {p.dataUrl ? (
                    <img src={p.dataUrl} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <>
                      <FileVideo className="w-6 h-6 text-blue-400" />
                      <span className="text-[10px] text-[var(--ff-text-muted)] truncate max-w-[80px]">{p.name}</span>
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full h-full rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] flex flex-col items-center justify-center gap-1">
                  <FileAudio className="w-6 h-6 text-green-400" />
                  <span className="text-[10px] text-[var(--ff-text-muted)] truncate max-w-[80px]">{p.name}</span>
                </div>
              )}
              <Button
                variant="danger"
                size="icon"
                onClick={(e) => { e.stopPropagation(); removePreview(i); }}
                className="absolute -top-2 -right-2 rounded-full z-10"
                aria-label="Remove preview"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {showLightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setShowLightbox(null)}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowLightbox(null)}
            aria-label="Close lightbox"
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 rounded-full"
          >
            <X className="w-6 h-6 text-white" />
          </Button>
          <img
            src={showLightbox}
            alt="Media enlarged"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
