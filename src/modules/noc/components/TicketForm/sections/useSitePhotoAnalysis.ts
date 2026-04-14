/**
 * useSitePhotoAnalysis — Hook for site photo EXIF extraction + VLM analysis + nearby drop lookup.
 * Returns suggested field values that the form can auto-fill.
 */

'use client';

import { useState, useCallback } from 'react';
import { createLogger } from '@/lib/logger';
import { extractGpsFromExif } from '../../../utils/exifGps';

const logger = createLogger('noc:site-photo-analysis');

// ==================== Types ====================

export interface PhotoAnalysisResult {
  // From EXIF
  gps: { latitude: number; longitude: number } | null;
  // From nearby-drops API
  nearbyDrop: {
    drop_number: string;
    project_id: string;
    project_name: string;
    zone_id: string | null;
    pole_uuid: string | null;
    pon: string | null;
    distance_meters: number;
  } | null;
  // From VLM
  vlm: {
    suggested_title: string;
    suggested_description: string;
    visible_dr_number: string | null;
    visible_pole_number: string | null;
    visible_serial: string | null;
    issue_type: string;
    severity: string;
    confidence: number;
  } | null;
}

export type AnalysisStatus = 'idle' | 'extracting' | 'analysing' | 'complete' | 'error';

export interface UseSitePhotoAnalysisReturn {
  status: AnalysisStatus;
  result: PhotoAnalysisResult | null;
  error: string | null;
  preview: string | null;
  file: File | null;
  analyse: (file: File) => Promise<PhotoAnalysisResult | null>;
  clear: () => void;
}

// ==================== Helpers ====================

/** Resize an image to max dimension for VLM (keeps aspect ratio) */
function resizeImageForVlm(file: File, maxDim: number = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      // Return base64 without data: prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.replace(/^data:image\/\w+;base64,/, ''));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

async function fetchVlmAnalysis(base64: string): Promise<PhotoAnalysisResult['vlm']> {
  const res = await fetch('/api/noc/ticket-photo-analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `VLM analysis failed (${res.status})`);
  }
  const json = await res.json();
  return json.data ?? null;
}

async function fetchNearbyDrops(lat: number, lng: number): Promise<PhotoAnalysisResult['nearbyDrop']> {
  const res = await fetch(`/api/noc/nearby-drops?lat=${lat}&lng=${lng}&radius=100`);
  if (!res.ok) return null;
  const json = await res.json();
  const drops = json.data;
  if (!Array.isArray(drops) || drops.length === 0) return null;
  return drops[0];
}

// ==================== Hook ====================

export function useSitePhotoAnalysis(): UseSitePhotoAnalysisReturn {
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [result, setResult] = useState<PhotoAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const clear = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
  }, [preview]);

  const analyse = useCallback(async (selectedFile: File): Promise<PhotoAnalysisResult | null> => {
    setError(null);
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));

    try {
      // Step 1: Extract EXIF GPS
      setStatus('extracting');
      const gps = await extractGpsFromExif(selectedFile);
      logger.info('EXIF extraction complete', { hasGps: !!gps, lat: gps?.latitude, lng: gps?.longitude });

      // Step 2: Run VLM analysis + nearby drop lookup in parallel
      setStatus('analysing');
      const base64 = await resizeImageForVlm(selectedFile);

      const [vlm, nearbyDrop] = await Promise.all([
        fetchVlmAnalysis(base64).catch(err => {
          logger.warn('VLM analysis failed', { error: err instanceof Error ? err.message : String(err) });
          return null;
        }),
        gps
          ? fetchNearbyDrops(gps.latitude, gps.longitude).catch(() => null)
          : Promise.resolve(null),
      ]);

      const analysisResult: PhotoAnalysisResult = { gps, nearbyDrop, vlm };
      setResult(analysisResult);
      setStatus('complete');

      logger.info('Photo analysis complete', {
        hasGps: !!gps,
        hasDrop: !!nearbyDrop,
        hasVlm: !!vlm,
        vlmConfidence: vlm?.confidence,
      });

      return analysisResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Photo analysis failed';
      setError(message);
      setStatus('error');
      logger.error('Photo analysis error', { error: message });
      return null;
    }
  }, []);

  return { status, result, error, preview, file, analyse, clear };
}
