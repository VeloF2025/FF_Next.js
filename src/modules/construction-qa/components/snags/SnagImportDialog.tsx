/**
 * SnagImportDialog — 4-step TQR report import dialog.
 * Step sub-components live in SnagImportSteps.tsx.
 */

'use client';

import { useState, useCallback } from 'react';
import { X, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { StepOne, StepTwo, StepThree, StepFour } from './SnagImportSteps';
import type { SnagEntry, Project } from './SnagImportSteps';
import { createSnagReport, createSnag } from '../../services/snagService';
import { log } from '@/lib/logger';
import type { CreateSnagRequest } from '../../types/snag.types';

interface SnagImportDialogProps {
  projects: Project[];
  onClose: () => void;
  onImported: (reportId: string) => void;
}

const EMPTY_SNAG: SnagEntry = {
  snag_number: 1,
  category: 'quality',
  severity: 'major',
  description: '',
  pole_references: '',
};

/** 🟢 WORKING: TQR report import dialog */
export function SnagImportDialog({ projects, onClose, onImported }: SnagImportDialogProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [projectId, setProjectId] = useState('');
  const [pdfFilename, setPdfFilename] = useState('');

  // Step 2
  const [reportNumber, setReportNumber] = useState('');
  const [siteName, setSiteName] = useState('');
  const [auditDate, setAuditDate] = useState('');
  const [auditor, setAuditor] = useState('');

  // Step 3
  const [snagEntries, setSnagEntries] = useState<SnagEntry[]>([{ ...EMPTY_SNAG }]);

  const addSnag = useCallback(() => {
    setSnagEntries((prev) => [
      ...prev,
      { ...EMPTY_SNAG, snag_number: prev.length + 1 },
    ]);
  }, []);

  const removeSnag = useCallback((index: number) => {
    setSnagEntries((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((s, i) => ({ ...s, snag_number: i + 1 }));
    });
  }, []);

  const updateSnagEntry = useCallback((index: number, field: keyof SnagEntry, value: string | number) => {
    setSnagEntries((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value } as SnagEntry;
      return next;
    });
  }, []);

  const handleImport = async () => {
    setSaving(true);
    try {
      const report = await createSnagReport({
        project_id: projectId,
        report_number: reportNumber.trim(),
        site_name: siteName || undefined,
        audit_date: auditDate,
        auditor: auditor || undefined,
        source_pdf_filename: pdfFilename || undefined,
      });

      for (const entry of snagEntries) {
        if (!entry.description.trim()) continue;
        const poleRefs = entry.pole_references
          ? entry.pole_references.split(',').map((r) => r.trim()).filter(Boolean)
          : [];

        const req: CreateSnagRequest = {
          report_id: report.id,
          project_id: projectId,
          snag_number: entry.snag_number,
          category: entry.category,
          severity: entry.severity,
          description: entry.description.trim(),
          pole_references: poleRefs.length > 0 ? poleRefs : undefined,
        };
        await createSnag(req);
      }

      log.info('TQR report imported', { reportId: report.id, snagCount: snagEntries.length });
      onImported(report.id);
    } catch (err) {
      log.error('TQR import failed', { err });
    } finally {
      setSaving(false);
    }
  };

  const isNextDisabled =
    (step === 1 && !projectId) ||
    (step === 2 && (!reportNumber.trim() || !auditDate));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Import TQR Report</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">Step {step} of 4</span>
            <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <StepOne
              projects={projects}
              projectId={projectId}
              pdfFilename={pdfFilename}
              onProjectChange={setProjectId}
              onFilenameChange={setPdfFilename}
            />
          )}
          {step === 2 && (
            <StepTwo
              reportNumber={reportNumber}
              siteName={siteName}
              auditDate={auditDate}
              auditor={auditor}
              onChange={{ setReportNumber, setSiteName, setAuditDate, setAuditor }}
            />
          )}
          {step === 3 && (
            <StepThree
              entries={snagEntries}
              onAdd={addSnag}
              onRemove={removeSnag}
              onUpdate={updateSnagEntry}
            />
          )}
          {step === 4 && (
            <StepFour
              projectName={projects.find((p) => String(p.id) === projectId)?.name ?? ''}
              reportNumber={reportNumber}
              auditDate={auditDate}
              snagCount={snagEntries.filter((s) => s.description.trim()).length}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 1}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={isNextDisabled}
              className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md font-medium"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { void handleImport(); }}
              disabled={saving}
              className="flex items-center gap-2 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-md font-medium"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Importing...' : 'Confirm Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
