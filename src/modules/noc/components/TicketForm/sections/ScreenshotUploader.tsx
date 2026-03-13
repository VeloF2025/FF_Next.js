/**
 * ScreenshotUploader - Multi-media DevOps ticket creation
 *
 * Accepts screenshots, screen recordings, and voice memos.
 * - Images: client-side resize → VLM analysis → auto-fill fields
 * - Videos: server-side frame extraction + Whisper transcription → auto-fill
 * - Audio: server-side Whisper transcription → LLM field extraction → auto-fill
 *
 * // WORKING: VLM + Whisper pipeline for DevOps tickets
 */

'use client';

import React, { useCallback, useState, useRef } from 'react';
import {
  Camera, Upload, Loader2, CheckCircle, AlertCircle, X,
  Maximize2, Monitor, Video, Mic, FileVideo, FileAudio,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScreenshotUploaderProps {
  onFieldsExtracted: (fields: Record<string, string>) => void;
  disabled?: boolean;
}

type MediaType = 'image' | 'video' | 'audio';

interface MediaPreview {
  dataUrl: string;
  name: string;
  type: MediaType;
}

const MAX_DIMENSION = 1280;
const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a';

const ANALYSING_MESSAGES: Record<MediaType, { title: string; subtitle: string }> = {
  image: {
    title: 'Analysing screenshot with AI...',
    subtitle: 'Extracting error details, module, and environment',
  },
  video: {
    title: 'Processing screen recording...',
    subtitle: 'Extracting frames + transcribing audio — this may take 30-60 seconds',
  },
  audio: {
    title: 'Transcribing voice memo...',
    subtitle: 'Converting speech to text and extracting issue details',
  },
};

function getMediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  // Fallback: check extension
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(ext)) return 'audio';
  return 'image';
}

function getMaxSize(type: MediaType): number {
  return type === 'image' ? 10 : 50; // MB
}

/** Resize image client-side using canvas to stay within VLM limits */
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Create a video thumbnail from the first frame */
function createVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadeddata = () => {
      video.currentTime = 0.5;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 320);
      canvas.height = Math.min(video.videoHeight, 240);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } else {
        resolve('');
      }
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve('');
    video.src = URL.createObjectURL(file);
  });
}

function extractApiFields(data: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  if (data.title) fields.title = data.title;
  if (data.description) fields.description = data.description;
  if (data.affected_module) fields.affected_module = data.affected_module;
  if (data.environment) fields.environment = data.environment;
  if (data.error_url) fields.error_url = data.error_url;
  if (data.stack_trace) fields.stack_trace = data.stack_trace;
  if (data.steps_to_reproduce) fields.steps_to_reproduce = data.steps_to_reproduce;
  if (data.browser_info) fields.browser_info = data.browser_info;
  if (data.priority_suggestion) fields.priority_suggestion = data.priority_suggestion;
  return fields;
}

export function ScreenshotUploader({ onFieldsExtracted, disabled }: ScreenshotUploaderProps) {
  const [previews, setPreviews] = useState<MediaPreview[]>([]);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analysingType, setAnalysingType] = useState<MediaType>('image');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showLightbox, setShowLightbox] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==================== Image Processing ====================
  const processImage = useCallback(async (file: File) => {
    const dataUrl = await resizeImage(file);
    setPreviews(prev => [...prev, { dataUrl, name: file.name || 'screenshot.png', type: 'image' }]);

    const response = await fetch('/api/noc/devops-vlm-analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: dataUrl }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Analysis failed' }));
      throw new Error(err.error?.message || err.error || `Analysis failed (${response.status})`);
    }

    const result = await response.json();
    return extractApiFields(result.data);
  }, []);

  // ==================== Video/Audio Processing ====================
  const processMedia = useCallback(async (file: File, mediaType: MediaType) => {
    // Generate thumbnail for video
    if (mediaType === 'video') {
      const thumb = await createVideoThumbnail(file);
      setPreviews(prev => [...prev, {
        dataUrl: thumb || '',
        name: file.name || 'recording',
        type: 'video',
      }]);
    } else {
      setPreviews(prev => [...prev, {
        dataUrl: '',
        name: file.name || 'voice-memo',
        type: 'audio',
      }]);
    }

    // Upload file to media analysis endpoint
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/noc/devops-media-analyse', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Media analysis failed' }));
      throw new Error(err.error?.message || err.error || `Media analysis failed (${response.status})`);
    }

    const result = await response.json();
    return extractApiFields(result.data);
  }, []);

  // ==================== Unified File Handler ====================
  const processFile = useCallback(async (file: File) => {
    const mediaType = getMediaType(file);
    const maxSize = getMaxSize(mediaType);

    if (file.size > maxSize * 1024 * 1024) {
      setError(`File too large (max ${maxSize}MB for ${mediaType})`);
      return;
    }

    setError(null);
    setIsAnalysing(true);
    setAnalysingType(mediaType);
    setAnalysisComplete(false);

    try {
      const fields = mediaType === 'image'
        ? await processImage(file)
        : await processMedia(file, mediaType);

      onFieldsExtracted(fields);
      setAnalysisComplete(true);

      const typeLabel = mediaType === 'image' ? 'screenshot' : mediaType === 'video' ? 'screen recording' : 'voice memo';
      setSuccessMessage(`Fields auto-populated from ${typeLabel} — review and edit below`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setError(msg);
    } finally {
      setIsAnalysing(false);
    }
  }, [processImage, processMedia, onFieldsExtracted]);

  // ==================== Event Handlers ====================
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled || isAnalysing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && (item.type.startsWith('image/') || item.type.startsWith('video/'))) {
        const file = item.getAsFile();
        if (file) { processFile(file); break; }
      }
    }
  }, [disabled, isAnalysing, processFile]);

  const removePreview = useCallback((index: number) => {
    setPreviews(prev => prev.filter((_, i) => i !== index));
  }, []);

  const analysingMsg = ANALYSING_MESSAGES[analysingType];

  return (
    <div className="space-y-3">
      {/* Instructions banner */}
      <div className="flex items-start gap-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
        <Monitor className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-purple-300">AI-powered bug reporting</p>
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
          error && 'border-red-400/50'
        )}
      >
        {isAnalysing ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-300">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <X className="w-3.5 h-3.5" />
          </button>
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
                    <img src={p.dataUrl} alt={p.name} className="w-full h-full object-cover" />
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
              <button
                onClick={(e) => { e.stopPropagation(); removePreview(i); }}
                className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 rounded-full p-1 transition-colors z-10"
              >
                <X className="w-3 h-3 text-white" />
              </button>
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
          <button
            onClick={() => setShowLightbox(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
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
