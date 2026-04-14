/**
 * SitePhotoUploader — Optional photo upload at the top of Ticket Details.
 * Extracts EXIF GPS, runs VLM analysis, and auto-fills form fields.
 */

'use client';

import { useRef, useState, useCallback } from 'react';
import { Camera, X, MapPin, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useSitePhotoAnalysis, type PhotoAnalysisResult } from './useSitePhotoAnalysis';
import type { TicketFormData } from '../../../hooks/useTicketForm';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

interface SitePhotoUploaderProps {
  setFields: (fields: Partial<TicketFormData>) => void;
  onDRFound?: (drNumber: string) => void;
  onFileReady?: (file: File) => void;
  disabled?: boolean;
}

export function SitePhotoUploader({ setFields, onDRFound, onFileReady, disabled }: SitePhotoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const analysis = useSitePhotoAnalysis();

  const applyResults = useCallback((result: PhotoAnalysisResult) => {
    const fields: Partial<TicketFormData> = {};

    // Priority 1: VLM found a DR number → trigger DR lookup (which fills everything)
    if (result.vlm?.visible_dr_number) {
      onDRFound?.(result.vlm.visible_dr_number);
    }
    // Priority 2: EXIF GPS + nearby drop found
    else if (result.nearbyDrop) {
      fields.dr_number = result.nearbyDrop.drop_number;
      fields.project_id = result.nearbyDrop.project_id;
      if (result.nearbyDrop.zone_id) fields.zone_id = result.nearbyDrop.zone_id;
      if (result.nearbyDrop.pole_uuid) fields.pole_number = result.nearbyDrop.pole_uuid;
      if (result.nearbyDrop.pon) fields.pon_number = result.nearbyDrop.pon;
    }

    // GPS coordinates from EXIF
    if (result.gps) {
      fields.latitude = result.gps.latitude.toFixed(6);
      fields.longitude = result.gps.longitude.toFixed(6);
    }

    // VLM suggestions for title/description (only if fields are currently empty)
    if (result.vlm && result.vlm.confidence >= 0.3) {
      if (result.vlm.suggested_title) fields.title = result.vlm.suggested_title;
      if (result.vlm.suggested_description) fields.description = result.vlm.suggested_description;
      if (result.vlm.visible_serial) fields.ont_serial = result.vlm.visible_serial;
    }

    if (Object.keys(fields).length > 0) {
      setFields(fields);
    }
  }, [setFields, onDRFound]);

  const handleFile = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      return;
    }

    onFileReady?.(file);
    const result = await analysis.analyse(file);
    if (result) {
      applyResults(result);
    }
  }, [analysis, applyResults, onFileReady]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { handleFile(file); break; }
      }
    }
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [handleFile]);

  const handleClear = useCallback(() => {
    analysis.clear();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [analysis]);

  const isProcessing = analysis.status === 'extracting' || analysis.status === 'analysing';

  return (
    <div className="space-y-3 mb-4" onPaste={handlePaste}>
      {/* Drop zone — shown when no photo yet */}
      {!analysis.preview && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={`relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            dragOver
              ? 'border-blue-400 bg-blue-500/10'
              : 'border-[var(--ff-border-light)] hover:border-blue-400/50 hover:bg-[var(--ff-bg-hover)]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <Camera className="w-6 h-6 text-[var(--ff-text-muted)]" />
          <div className="text-center">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              <span className="text-blue-400 font-medium">Upload a site photo</span> to auto-detect location and details
            </p>
            <p className="text-xs text-[var(--ff-text-muted)] mt-1">
              Drop image here, paste, or click to browse
            </p>
          </div>
        </div>
      )}

      {/* Preview + status */}
      {analysis.preview && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]">
          {/* Thumbnail */}
          <div className="relative flex-shrink-0 w-16 h-16 rounded overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={analysis.preview}
              alt="Site photo"
              className="w-full h-full object-cover"
            />
            {!isProcessing && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            )}
          </div>

          {/* Status / Results */}
          <div className="flex-1 min-w-0">
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                {analysis.status === 'extracting' ? 'Reading photo data...' : 'Analysing photo...'}
              </div>
            )}

            {analysis.status === 'complete' && analysis.result && (
              <ResultsSummary result={analysis.result} />
            )}

            {analysis.status === 'error' && (
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                {analysis.error || 'Analysis failed — you can still fill in details manually'}
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}

/** Compact summary of what was auto-detected */
function ResultsSummary({ result }: { result: PhotoAnalysisResult }) {
  const items: string[] = [];

  if (result.nearbyDrop) {
    items.push(`DR ${result.nearbyDrop.drop_number} (${result.nearbyDrop.distance_meters}m away)`);
    items.push(result.nearbyDrop.project_name);
  } else if (result.vlm?.visible_dr_number) {
    items.push(`DR ${result.vlm.visible_dr_number} (from photo)`);
  }

  if (result.gps && !result.nearbyDrop) {
    items.push(`GPS: ${result.gps.latitude.toFixed(4)}, ${result.gps.longitude.toFixed(4)}`);
  }

  if (result.vlm?.visible_serial) {
    items.push(`Serial: ${result.vlm.visible_serial}`);
  }

  const hasInfo = items.length > 0;
  const vlmOnly = !hasInfo && result.vlm && result.vlm.confidence >= 0.3;

  return (
    <div className="space-y-1">
      {hasInfo && (
        <div className="flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--ff-text-primary)]">
            {items.map((item, i) => (
              <span key={i}>
                {i > 0 && <span className="text-[var(--ff-text-muted)]"> · </span>}
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
      {vlmOnly && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle className="w-4 h-4" />
          Title and description auto-filled from photo
        </div>
      )}
      {result.gps && result.nearbyDrop && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--ff-text-muted)]">
          <MapPin className="w-3 h-3" />
          GPS: {result.gps.latitude.toFixed(4)}, {result.gps.longitude.toFixed(4)}
        </div>
      )}
      {!hasInfo && !vlmOnly && (
        <div className="text-sm text-[var(--ff-text-muted)]">
          No location data found — fill in details manually
        </div>
      )}
    </div>
  );
}
