'use client';

/**
 * EOD Sheet Reviewer
 * Editable review pane for a single VLM-extracted install sheet
 */

import { useState } from 'react';
import { CheckCircle, XCircle, SkipForward, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EodEntryTable } from './EodEntryTable';
import type { EodVlmExtraction, EodVlmEntry, EodSavePayload } from '../../../types';

const LOW_CONFIDENCE_THRESHOLD = 0.5;

interface EodSheetReviewerProps {
  extraction: EodVlmExtraction;
  sheetIndex: number;
  totalSheets: number;
  saving: boolean;
  error: string | null;
  onSave: (payload: EodSavePayload) => Promise<void>;
  onSkip: () => void;
}

/**
 * Review pane for a single EOD install sheet.
 * IMPORTANT: Pass key={sheetIndex} from the parent so React remounts this
 * component on each sheet transition and resets local state from the new extraction.
 */
export function EodSheetReviewer({
  extraction,
  sheetIndex,
  totalSheets,
  saving,
  error,
  onSave,
  onSkip,
}: EodSheetReviewerProps) {
  const [entries, setEntries] = useState<EodVlmEntry[]>(extraction.entries);
  const [sheetDate, setSheetDate] = useState(extraction.date ?? '');
  const [vfRepName, setVfRepName] = useState(extraction.velocity_rep_name ?? '');
  const [vfRepId, setVfRepId] = useState(extraction.velocity_rep_id ?? '');
  const [techName, setTechName] = useState(extraction.technician_name ?? '');
  const [techId, setTechId] = useState(extraction.technician_id ?? '');
  const [acknowledgeLowConfidence, setAcknowledgeLowConfidence] = useState(false);

  const handleSave = async () => {
    await onSave({
      sheetDate,
      velocityRepName: vfRepName || null,
      velocityRepId: vfRepId || null,
      technicianName: techName || null,
      technicianId: techId || null,
      entries,
      vlmExtraction: extraction, // intentionally the original prop, not the user-edited entries
    });
  };

  const inputCls = 'w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-3 py-2 text-sm text-[var(--ff-text-primary)] focus:outline-none focus:border-[var(--ff-accent)]';
  const labelCls = 'text-xs text-[var(--ff-text-secondary)] mb-1 block';

  const drFilledCount = entries.filter((e) => e.dr_number && e.dr_number.trim().length > 0).length;
  const allDrsBlank = entries.length > 0 && drFilledCount === 0;
  const lowConfidence = extraction.overall_confidence < LOW_CONFIDENCE_THRESHOLD;
  // allDrsBlank is a HARD block (cannot write back without DRs).
  // lowConfidence is a SOFT block — user can override by ticking the acknowledgement.
  const blockSave = allDrsBlank || (lowConfidence && !acknowledgeLowConfidence);
  const confidencePct = Math.round(extraction.overall_confidence * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Review Sheet {sheetIndex + 1} of {totalSheets}
        </h3>
        <span className={`text-xs ${lowConfidence ? 'text-red-400 font-medium' : 'text-[var(--ff-text-tertiary)]'}`}>
          Confidence: {confidencePct}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="col-span-2 md:col-span-1">
          <label className={labelCls}>Date</label>
          <input
            type="date"
            value={sheetDate}
            onChange={(e) => setSheetDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className={labelCls}>VF Representative</label>
          <input
            value={vfRepName}
            onChange={(e) => setVfRepName(e.target.value)}
            placeholder="VF rep name"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>VF Rep ID</label>
          <input
            value={vfRepId}
            onChange={(e) => setVfRepId(e.target.value)}
            placeholder="Emp ID"
            className={inputCls}
          />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className={labelCls}>Contractor Technician</label>
          <input
            value={techName}
            onChange={(e) => setTechName(e.target.value)}
            placeholder="Tech name"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Tech ID</label>
          <input
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            placeholder="Tech ID"
            className={inputCls}
          />
        </div>
      </div>

      {extraction.low_resolution_warning && (
        <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-300 space-y-1 flex-1">
            <p className="font-medium">Photo resolution too low to decode barcodes.</p>
            <p>
              This photo is {extraction.source_width ?? '?'}×{extraction.source_height ?? '?'}px.
              The 10 ONT stickers on a single sheet are too small at this resolution for the
              barcode scanner — only handwriting OCR can run, and OCR misreads small printed
              text. For exact reads, re-upload via the app&apos;s file picker, or send the
              photo through WhatsApp as a <strong>Document</strong> (not Image) so it
              isn&apos;t compressed.
            </p>
          </div>
        </div>
      )}

      <EodEntryTable entries={entries} editable onChange={setEntries} />

      {(allDrsBlank || lowConfidence) && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-300 space-y-2 flex-1">
            <p className="font-medium">VLM extraction unreliable — review carefully.</p>
            {allDrsBlank && (
              <p>DR Number column is empty for all {entries.length} rows. Type the DR numbers from the photo before saving, or Skip this sheet.</p>
            )}
            {lowConfidence && !allDrsBlank && (
              <>
                <p>Overall confidence is {confidencePct}% (threshold {Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}%). Verify and correct each row against the photo before saving.</p>
                <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
                  <input
                    type="checkbox"
                    checked={acknowledgeLowConfidence}
                    onChange={(e) => setAcknowledgeLowConfidence(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                  <span>I have verified all rows against the photo</span>
                </label>
              </>
            )}
            {lowConfidence && allDrsBlank && (
              <p>Confidence is {confidencePct}%. Verify every column against the photo, not just DR Numbers.</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="primary"
          onClick={() => { void handleSave(); }}
          disabled={saving || !sheetDate || entries.length === 0 || blockSave}
          loading={saving}
          className="flex-1"
        >
          <CheckCircle className="w-5 h-5" />
          {totalSheets > 1 ? `Save & Next (${entries.length} entries)` : `Save Sheet (${entries.length} entries)`}
        </Button>
        <Button variant="secondary" onClick={onSkip} disabled={saving}>
          <SkipForward className="w-4 h-4" />
          Skip
        </Button>
      </div>
    </div>
  );
}
