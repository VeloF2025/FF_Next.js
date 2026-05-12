'use client';

/**
 * EOD Sheet Reviewer
 * Editable review pane for a single VLM-extracted install sheet
 */

import { useState } from 'react';
import { CheckCircle, XCircle, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EodEntryTable } from './EodEntryTable';
import type { EodVlmExtraction, EodVlmEntry, EodSavePayload } from '../../../types';

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
  const [techName, setTechName] = useState(extraction.technician_name ?? '');
  const [techId, setTechId] = useState(extraction.technician_id ?? '');

  const handleSave = async () => {
    await onSave({
      sheetDate,
      technicianName: techName || null,
      technicianId: techId || null,
      entries,
      vlmExtraction: extraction,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Review Sheet {sheetIndex + 1} of {totalSheets}
        </h3>
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          Confidence: {Math.round(extraction.overall_confidence * 100)}%
        </span>
      </div>

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

      <EodEntryTable entries={entries} editable onChange={setEntries} />

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
          disabled={saving || !sheetDate || entries.length === 0}
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
