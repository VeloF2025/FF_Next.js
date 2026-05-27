import React from 'react';

import { CombinedPreviewPanel } from './CombinedPreviewPanel';
import { CommitSummaryBanner, ImportUpload } from './ImportUpload';
import { PeriodSkipsPanel } from './PeriodSkipsPanel';
import { useCombinedImport } from './hooks/useCombinedImport';

/**
 * The Combined-PDF tab on /staff/payslips/import.
 *
 * Acts as the controller: pulls state + handlers from `useCombinedImport`
 * and wires them into the presentational sub-components.
 */
export function CombinedPdfTab() {
  const ctx = useCombinedImport();
  const { preview } = ctx;

  return (
    <div className="space-y-6">
      <ImportUpload
        pdfFile={ctx.pdfFile}
        preview={ctx.preview}
        submitting={ctx.submitting}
        error={ctx.error}
        forceReimport={ctx.forceReimport}
        allResolved={ctx.allResolved}
        unresolvedCount={ctx.unresolvedCount}
        counts={ctx.counts}
        skipByPage={ctx.skipByPage}
        onPickFile={ctx.setPdfFile}
        onSubmit={ctx.submit}
        onForceReimportChange={ctx.setForceReimport}
        onSkipAllUnmatched={ctx.skipAllUnmatched}
      />

      {preview && <CommitSummaryBanner preview={preview} />}

      {preview && preview.periodSkips.filter((s) => s.resolvedAt === null).length > 0 && (
        <PeriodSkipsPanel skips={preview.periodSkips} />
      )}

      {preview && (
        <CombinedPreviewPanel
          preview={preview}
          manualByPage={ctx.manualByPage}
          casualByPage={ctx.casualByPage}
          skipByPage={ctx.skipByPage}
          resolutionByPage={ctx.resolutionByPage}
          forceReimport={ctx.forceReimport}
          usedStaffIds={ctx.usedStaffIds}
          onSetMapping={ctx.setMapping}
          onSetCasual={ctx.setCasualDraft}
          onToggleSkip={ctx.toggleSkip}
        />
      )}
    </div>
  );
}
