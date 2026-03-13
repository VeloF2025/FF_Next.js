/**
 * Hook for screenshot/media upload state and processing logic
 */

'use client';

import { useCallback, useState, useRef } from 'react';
import {
  type MediaType,
  type MediaPreview,
  getMediaType,
  getMaxSize,
  resizeImage,
  createVideoThumbnail,
  extractApiFields,
} from './screenshotUtils';

interface UseScreenshotUploaderOptions {
  onFieldsExtracted: (fields: Record<string, string>) => void;
  disabled?: boolean;
}

export function useScreenshotUploader({ onFieldsExtracted, disabled }: UseScreenshotUploaderOptions) {
  const [previews, setPreviews] = useState<MediaPreview[]>([]);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analysingType, setAnalysingType] = useState<MediaType>('image');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showLightbox, setShowLightbox] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(async (file: File) => {
    const dataUrl = await resizeImage(file);
    setPreviews(prev => [...prev, { dataUrl, name: file.name || 'screenshot.png', type: 'image' }]);

    const response = await fetch('/api/noc/devops-vlm-analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ imageBase64: dataUrl }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Analysis failed' }));
      throw new Error(err.error?.message || err.error || `Analysis failed (${response.status})`);
    }

    const result = await response.json();
    return extractApiFields(result.data);
  }, []);

  const processMedia = useCallback(async (file: File, mediaType: MediaType) => {
    if (mediaType === 'video') {
      const thumb = await createVideoThumbnail(file);
      setPreviews(prev => [...prev, { dataUrl: thumb || '', name: file.name || 'recording', type: 'video' }]);
    } else {
      setPreviews(prev => [...prev, { dataUrl: '', name: file.name || 'voice-memo', type: 'audio' }]);
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/noc/devops-media-analyse', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Media analysis failed' }));
      throw new Error(err.error?.message || err.error || `Media analysis failed (${response.status})`);
    }

    const result = await response.json();
    return extractApiFields(result.data);
  }, []);

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

  return {
    previews,
    isAnalysing,
    analysingType,
    isDragging,
    error,
    analysisComplete,
    successMessage,
    showLightbox,
    setShowLightbox,
    setError,
    fileInputRef,
    handleFileInput,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    removePreview,
  };
}
