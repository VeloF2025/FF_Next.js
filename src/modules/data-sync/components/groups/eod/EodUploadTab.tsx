/**
 * EOD Upload Tab
 * Photo upload of physical install sheets with VLM extraction and review
 */

'use client';

import { useState, useRef } from 'react';
import { Upload, CheckCircle, Camera, XCircle, AlertTriangle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import type { EodVlmExtraction, EodVlmEntry } from '../../../types';
import { EodEntryTable } from './EodEntryTable';

export function EodUploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extraction, setExtraction] = useState<EodVlmExtraction | null>(null);
  const [entries, setEntries] = useState<EodVlmEntry[]>([]);
  const [sheetDate, setSheetDate] = useState('');
  const [techName, setTechName] = useState('');
  const [techId, setTechId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [lowRes, setLowRes] = useState(false);
  const [imageRes, setImageRes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setError(null);
    setSaved(false);
    setExtraction(null);
    setLowRes(false);

    // Check image resolution
    const img = new Image();
    img.onload = () => {
      const mp = (img.width * img.height) / 1_000_000;
      setImageRes(`${img.width}x${img.height} (${mp.toFixed(1)}MP)`);
      if (mp < 2) setLowRes(true);
    };

    // Create preview
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(f);
  };

  const handleExtract = async () => {
    if (!preview) return;
    setExtracting(true);
    setError(null);

    try {
      const base64 = preview.split(',')[1];
      const res = await fetch('/api/eod/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.message || 'Extraction failed');
        return;
      }

      const data = json.data as EodVlmExtraction;
      setExtraction(data);
      setEntries(data.entries);
      if (data.date) setSheetDate(data.date);
      if (data.technician_name) setTechName(data.technician_name);
      if (data.technician_id) setTechId(data.technician_id);
    } catch (err) {
      setError('Failed to extract data from photo');
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!sheetDate || entries.length === 0) {
      setError('Date and at least one entry required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/eod/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetDate,
          technicianName: techName || null,
          technicianId: techId || null,
          vlmRawJson: extraction,
          entries: entries.map((e) => ({
            row_number: e.row_number,
            ont_serial: e.ont_serial,
            gizzu_serial: e.gizzu_serial,
            dr_number: e.dr_number,
            pon_number: e.pon_number,
            address: e.address,
          })),
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.message || 'Failed to save');
        return;
      }

      setSaved(true);
    } catch (err) {
      setError('Failed to save sheet');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setExtraction(null);
    setEntries([]);
    setSheetDate('');
    setTechName('');
    setTechId('');
    setError(null);
    setSaved(false);
  };

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle className="w-16 h-16 text-green-400 mb-4" />
        <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Sheet Saved</h3>
        <p className="text-[var(--ff-text-secondary)] mb-6">
          {entries.length} entries saved for {sheetDate}. Check Reconciliation tab to compare with WA DRs and OES.
        </p>
        <Button variant="primary" onClick={reset}>
          Upload Another Sheet
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      {!extraction && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-[var(--ff-accent)]'); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove('border-[var(--ff-accent)]'); }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('border-[var(--ff-accent)]');
            const f = e.dataTransfer.files[0];
            if (f && f.type.startsWith('image/')) handleFile(f);
          }}
          className="border-2 border-dashed border-[var(--ff-border-medium)] rounded-lg p-8 text-center cursor-pointer hover:border-[var(--ff-accent)] transition-colors"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {preview ? (
            <div className="space-y-4">
              <img src={preview} alt="EOD sheet" className="max-h-64 mx-auto rounded-lg" />
              <p className="text-sm text-[var(--ff-text-secondary)]">{file?.name} {imageRes && `\u2014 ${imageRes}`}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-center gap-4">
                <Camera className="w-10 h-10 text-[var(--ff-text-tertiary)]" />
                <Upload className="w-10 h-10 text-[var(--ff-text-tertiary)]" />
              </div>
              <p className="text-[var(--ff-text-secondary)]">
                Take a photo or drag & drop the EOD install sheet
              </p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                Supports JPG, PNG — the VLM will extract all fields automatically
              </p>
            </div>
          )}
        </div>
      )}

      {/* Low Resolution Warning */}
      {lowRes && preview && !extraction && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Low resolution image ({imageRes})</p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
              WhatsApp compresses photos to low resolution, making barcode stickers unreadable.
              For better ONT serial extraction, ask the field team to send the <strong>original photo</strong> from
              their camera roll (not via WhatsApp), or take the photo directly using the camera button above.
            </p>
          </div>
        </div>
      )}

      {/* Extract Button */}
      {preview && !extraction && (
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[var(--ff-accent)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {extracting ? (
            <>
              <InlineSpinner size="sm" />
              Extracting with VLM...
            </>
          ) : (
            <>Extract Data</>
          )}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Review extracted data */}
      {extraction && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Review Extracted Data
            </h3>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              Confidence: {Math.round(extraction.overall_confidence * 100)}%
            </span>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Date</label>
              <input
                type="date"
                value={sheetDate}
                onChange={(e) => setSheetDate(e.target.value)}
                className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Technician Name</label>
              <input
                value={techName}
                onChange={(e) => setTechName(e.target.value)}
                className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--ff-text-secondary)] mb-1 block">Technician ID</label>
              <input
                value={techId}
                onChange={(e) => setTechId(e.target.value)}
                className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]"
              />
            </div>
          </div>

          {/* Entries table */}
          <EodEntryTable entries={entries} editable onChange={setEntries} />

          {/* Save */}
          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={() => { void handleSave(); }}
              disabled={saving || !sheetDate}
              loading={saving}
              className="flex-1"
            >
              <CheckCircle className="w-5 h-5" />
              Save Sheet ({entries.length} entries)
            </Button>
            <Button
              variant="secondary"
              onClick={reset}
            >
              Start Over
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
