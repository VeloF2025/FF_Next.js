/**
 * SnagImportSteps — Step sub-components for the TQR import dialog.
 * Used by SnagImportDialog.tsx.
 * Constants and types live in snag-import-constants.ts.
 */

'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  CATEGORY_OPTIONS,
  SEVERITY_OPTIONS,
  type SnagEntry,
  type Project,
} from './snag-import-constants';

// Re-export so callers can import from here
export type { SnagEntry, Project };

// ============================================================
// Step 1: Project + PDF
// ============================================================

interface StepOneProps {
  projects: Project[];
  projectId: string;
  pdfFilename: string;
  onProjectChange: (v: string) => void;
  onFilenameChange: (v: string) => void;
}

export function StepOne({ projects, projectId, pdfFilename, onProjectChange, onFilenameChange }: StepOneProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">Select the project and provide the TQR PDF filename.</p>
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">Project *</label>
        <Select value={projectId} onValueChange={onProjectChange}>
          <SelectTrigger className="w-full bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectValue placeholder="Select project..." />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)} className="text-zinc-100">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">PDF Filename (optional)</label>
        <input
          type="text"
          value={pdfFilename}
          onChange={(e) => onFilenameChange(e.target.value)}
          placeholder="Etwatwa POP 2 TQR 00182026.pdf"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
      </div>
    </div>
  );
}

// ============================================================
// Step 2: Report metadata
// ============================================================

interface StepTwoProps {
  reportNumber: string;
  siteName: string;
  auditDate: string;
  auditor: string;
  onChange: {
    setReportNumber: (v: string) => void;
    setSiteName: (v: string) => void;
    setAuditDate: (v: string) => void;
    setAuditor: (v: string) => void;
  };
}

export function StepTwo({ reportNumber, siteName, auditDate, auditor, onChange }: StepTwoProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">Enter the TQR report metadata from the cover page.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Report Number *</label>
          <input
            type="text"
            value={reportNumber}
            onChange={(e) => onChange.setReportNumber(e.target.value)}
            placeholder="TQR 0018/2026"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Audit Date *</label>
          <input
            type="date"
            value={auditDate}
            onChange={(e) => onChange.setAuditDate(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Site Name</label>
          <input
            type="text"
            value={siteName}
            onChange={(e) => onChange.setSiteName(e.target.value)}
            placeholder="ETW.02.797012"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Auditor</label>
          <input
            type="text"
            value={auditor}
            onChange={(e) => onChange.setAuditor(e.target.value)}
            placeholder="Fabian Redcliffe"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Step 3: Add snag entries
// ============================================================

interface StepThreeProps {
  entries: SnagEntry[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, field: keyof SnagEntry, value: string | number) => void;
}

export function StepThree({ entries, onAdd, onRemove, onUpdate }: StepThreeProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">Add findings from the TQR PDF.</p>
      {entries.map((entry, i) => (
        <div key={i} className="bg-zinc-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">Finding #{entry.snag_number}</span>
            {entries.length > 1 && (
              <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(i)} aria-label="Remove finding">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500 mb-0.5 block">Category</label>
              <Select value={entry.category} onValueChange={(v) => onUpdate(i, 'category', v)}>
                <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700 text-zinc-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-zinc-100 text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-0.5 block">Severity</label>
              <Select value={entry.severity} onValueChange={(v) => onUpdate(i, 'severity', v)}>
                <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700 text-zinc-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {SEVERITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-zinc-100 text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-0.5 block">Description *</label>
            <textarea
              value={entry.description}
              onChange={(e) => onUpdate(i, 'description', e.target.value)}
              placeholder="HDPE pipes is a tripping hazard..."
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-0.5 block">Pole References (comma separated)</label>
            <input
              type="text"
              value={entry.pole_references}
              onChange={(e) => onUpdate(i, 'pole_references', e.target.value)}
              placeholder="PH258B, PH256"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>
      ))}
      <Button type="button" variant="link" size="sm" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        Add Finding
      </Button>
    </div>
  );
}

// ============================================================
// Step 4: Review and confirm
// ============================================================

interface StepFourProps {
  projectName: string;
  reportNumber: string;
  auditDate: string;
  snagCount: number;
}

export function StepFour({ projectName, reportNumber, auditDate, snagCount }: StepFourProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">Review and confirm the import.</p>
      <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Project</span>
          <span className="text-zinc-100">{projectName}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Report Number</span>
          <span className="text-zinc-100">{reportNumber}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Audit Date</span>
          <span className="text-zinc-100">{auditDate}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Findings to Import</span>
          <span className="text-zinc-100 font-semibold">{snagCount}</span>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Clicking &quot;Confirm Import&quot; will create the report record and all findings in the database.
      </p>
    </div>
  );
}
