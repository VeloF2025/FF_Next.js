/**
 * BillingUploadTab
 * Drag-drop upload for FiberTime payment summary PDF + optional notes XLSX.
 * Calls POST /api/billing/upload-weekly (action=preview then action=import),
 * then POST /api/billing/reconcile to run reconciliation.
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
  Upload,
  FileText,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';

type Project = 'Lawley' | 'Mohadin' | 'Mamelodi';

const PROJECTS: Project[] = ['Lawley', 'Mohadin', 'Mamelodi'];

interface BillingPreview {
  weekEnding: string;
  project: string;
  totalOnts: number;
  claimable: number;
  note1Count: number;
  note2Count: number;
  note3Count: number;
  note4Count: number;
  note5Count: number;
  preProviCount: number;
  totalClaimable: number;
  pricePerDrop: number | null;
  taxRate: number;
  invoiceSubtotal: number | null;
  invoiceTotal: number | null;
}

interface ImportResult {
  id: string;
  weekEnding: string;
  project: string;
  totalClaimable: number;
  invoiceTotal: number | null;
}

type UploadState = 'idle' | 'previewing' | 'previewed' | 'importing' | 'imported' | 'reconciling' | 'done';

// 🟢 WORKING: Full upload + preview + import + reconcile flow
export function BillingUploadTab() {
  const [project, setProject] = useState<Project>('Lawley');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);

  // ── Drag & Drop handlers ──────────────────────────────────────────────────

  const handlePdfDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPdf(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.pdf')) {
      setPdfFile(file);
      setPreview(null);
      setError(null);
    } else {
      setError('Please drop a PDF file for the payment summary');
    }
  }, []);

  const handlePdfDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPdf(true);
  };

  const handlePdfDragLeave = () => setIsDraggingPdf(false);

  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      setPreview(null);
      setError(null);
    }
  };

  const handleXlsxSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setXlsxFile(file);
  };

  // ── Preview ───────────────────────────────────────────────────────────────

  const handlePreview = async () => {
    if (!pdfFile) {
      setError('Please select a payment summary PDF first');
      return;
    }
    setUploadState('previewing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('action', 'preview');
      formData.append('project', project);
      formData.append('pdf', pdfFile);
      if (xlsxFile) formData.append('xlsx', xlsxFile);

      const res = await fetch('/api/billing/upload-weekly', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');

      setPreview(data.preview as BillingPreview);
      setUploadState('previewed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setUploadState('idle');
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!pdfFile || !preview) return;
    setUploadState('importing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('action', 'import');
      formData.append('project', project);
      formData.append('pdf', pdfFile);
      if (xlsxFile) formData.append('xlsx', xlsxFile);

      const res = await fetch('/api/billing/upload-weekly', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      setImportResult(data.result as ImportResult);
      setUploadState('imported');
      toast.success(`Week ending ${(data.result as ImportResult).weekEnding} imported successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setUploadState('previewed');
    }
  };

  // ── Reconcile ────────────────────────────────────────────────────────────

  const handleReconcile = async () => {
    if (!importResult) return;
    setUploadState('reconciling');
    setError(null);

    try {
      const res = await fetch('/api/billing/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: importResult.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reconciliation failed');

      setUploadState('done');
      toast.success('Reconciliation complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation failed');
      setUploadState('imported');
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setPdfFile(null);
    setXlsxFile(null);
    setPreview(null);
    setImportResult(null);
    setUploadState('idle');
    setError(null);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatCurrency = (val: number | null) =>
    val == null
      ? '—'
      : `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

  const isLoading =
    uploadState === 'previewing' ||
    uploadState === 'importing' ||
    uploadState === 'reconciling';

  const isLocked =
    uploadState === 'imported' || uploadState === 'done';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Project Selector */}
      <div className="max-w-xs">
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Project
        </label>
        <select
          value={project}
          onChange={(e) => setProject(e.target.value as Project)}
          disabled={isLoading || isLocked}
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent disabled:opacity-50"
        >
          {PROJECTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* PDF Drop Zone */}
      {!pdfFile ? (
        <div
          onDrop={handlePdfDrop}
          onDragOver={handlePdfDragOver}
          onDragLeave={handlePdfDragLeave}
          onClick={() => document.getElementById('billing-pdf-input')?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDraggingPdf
              ? 'border-[var(--ff-accent)] bg-[var(--ff-accent)]/5'
              : 'border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
          }`}
        >
          <input
            id="billing-pdf-input"
            type="file"
            accept=".pdf"
            onChange={handlePdfSelect}
            className="hidden"
          />
          <Upload className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">
            Drag and drop payment summary PDF, or click to browse
          </p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">Accepts .pdf files</p>
        </div>
      ) : (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-red-400" />
              <div>
                <p className="font-medium text-[var(--ff-text-primary)]">{pdfFile.name}</p>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {(pdfFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            {uploadState === 'idle' && (
              <button
                onClick={() => { setPdfFile(null); setPreview(null); }}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {/* Optional XLSX input */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Notes XLSX{' '}
          <span className="text-[var(--ff-text-tertiary)]">(optional)</span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => document.getElementById('billing-xlsx-input')?.click()}
            disabled={isLoading || isLocked}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-400" />
            {xlsxFile ? xlsxFile.name : 'Choose file…'}
          </button>
          {xlsxFile && (
            <button
              type="button"
              onClick={() => setXlsxFile(null)}
              disabled={isLoading}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          )}
        </div>
        <input
          id="billing-xlsx-input"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleXlsxSelect}
          className="hidden"
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-400">Error</p>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Preview Button */}
      {pdfFile && uploadState === 'idle' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handlePreview}
            className="flex items-center gap-2 px-5 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <Upload className="w-4 h-4" />
            Preview
          </button>
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-accent)]" />
          <span className="text-[var(--ff-text-secondary)]">
            {uploadState === 'previewing' && 'Parsing PDF…'}
            {uploadState === 'importing' && 'Importing…'}
            {uploadState === 'reconciling' && 'Running reconciliation…'}
          </span>
        </div>
      )}

      {/* Preview Card */}
      {preview &&
        (uploadState === 'previewed' ||
          uploadState === 'imported' ||
          uploadState === 'done') && (
          <div className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-5 space-y-4">
            <h3 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              Preview — Week ending {preview.weekEnding}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Project', value: preview.project },
                { label: 'Total ONTs', value: preview.totalOnts.toLocaleString() },
                { label: 'FT Claimable', value: preview.claimable.toLocaleString() },
                { label: 'Invoice Total', value: formatCurrency(preview.invoiceTotal) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-[var(--ff-bg-secondary)] rounded p-3 text-center"
                >
                  <p className="text-lg font-bold text-[var(--ff-text-primary)]">
                    {item.value}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>

            {/* Note breakdown */}
            <div className="border-t border-[var(--ff-border-light)] pt-3">
              <p className="text-xs font-medium text-[var(--ff-text-secondary)] mb-2">
                Note Breakdown
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Note 1', count: preview.note1Count, cls: 'text-orange-400 bg-orange-500/10' },
                  { label: 'Note 2', count: preview.note2Count, cls: 'text-blue-400 bg-blue-500/10' },
                  { label: 'Note 3', count: preview.note3Count, cls: 'text-yellow-400 bg-yellow-500/10' },
                  { label: 'Note 4', count: preview.note4Count, cls: 'text-red-400 bg-red-500/10' },
                  { label: 'Note 5', count: preview.note5Count, cls: 'text-purple-400 bg-purple-500/10' },
                  { label: 'Pre-Prov', count: preview.preProviCount, cls: 'text-cyan-400 bg-cyan-500/10' },
                ].map((n) => (
                  <span
                    key={n.label}
                    className={`px-2 py-1 rounded text-xs font-medium ${n.cls}`}
                  >
                    {n.label}: {n.count}
                  </span>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--ff-border-light)] pt-3 flex items-center justify-between text-sm">
              <span className="text-[var(--ff-text-secondary)]">
                Total Claimable:{' '}
                <span className="font-semibold text-[var(--ff-text-primary)]">
                  {preview.totalClaimable.toLocaleString()}
                </span>
              </span>
              <span className="text-[var(--ff-text-secondary)]">
                Invoice Total:{' '}
                <span className="font-semibold text-[var(--ff-text-primary)]">
                  {formatCurrency(preview.invoiceTotal)}
                </span>
              </span>
            </div>

            {/* Import Button (only when still in previewed state) */}
            {uploadState === 'previewed' && (
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  <Upload className="w-4 h-4" />
                  Import
                </button>
              </div>
            )}
          </div>
        )}

      {/* Success State + Reconcile Button */}
      {(uploadState === 'imported' || uploadState === 'done') && importResult && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-green-400">
                {uploadState === 'done'
                  ? 'Import + Reconciliation complete'
                  : 'Import successful'}
              </p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                Week {importResult.weekEnding} · {importResult.project} ·{' '}
                {formatCurrency(importResult.invoiceTotal)}
              </p>

              {uploadState === 'imported' && (
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={handleReconcile}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Run Reconciliation
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                  >
                    Upload Another
                  </button>
                </div>
              )}

              {uploadState === 'done' && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="mt-4 px-4 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)]"
                >
                  Upload Another Week
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
