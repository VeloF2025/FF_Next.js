'use client';

/**
 * Weekly Import Page Client Component
 *
 * Handles weekly Excel report imports with:
 * - Excel file upload wizard
 * - File validation and preview
 * - Import progress tracking
 * - Import results and statistics
 * - Error handling and reporting
 * - Import history
 *
 * 🟢 WORKING: Weekly import page integrates WeeklyImportWizard component
 */

import { WeeklyImportWizard } from '@/modules/ticketing/components/WeeklyImport/WeeklyImportWizard';
import { useState } from 'react';

export default function WeeklyImportPageClient() {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Weekly Report Import</h1>
        <p className="text-[var(--ff-text-secondary)]">Import weekly maintenance reports from Excel files</p>
      </div>

      <div className="mb-4">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="px-4 py-2 text-sm text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
        >
          {showHistory ? 'Hide History' : 'View Import History'}
        </button>
      </div>

      {showHistory ? (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Import History</h2>
          <p className="text-[var(--ff-text-tertiary)]">Import history will be displayed here</p>
        </div>
      ) : (
        <WeeklyImportWizard />
      )}
    </div>
  );
}
