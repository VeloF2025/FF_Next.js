/**
 * WeeklyImportWizard Component - Multi-step wizard for weekly report imports
 *
 * 🟢 WORKING: Production-ready import wizard component
 *
 * Features:
 * - Step 1: File upload with validation (auto-parses on select)
 * - Step 2: Preview parsed data with validation errors
 * - Step 3: Confirm and start import
 * - Step 4: Show import results
 * - Progress overlay with phases (parsing, uploading, processing, complete)
 * - Toast notifications for success/failure
 * - Error handling at each step
 */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  XCircle,
  RefreshCw,
  Database,
  FileCheck,
} from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { ImportPreview } from './ImportPreview';
import { ImportResults } from './ImportResults';
import { ImportProgressOverlay, type ImportPhase } from '@/modules/activate/components/ImportProgressOverlay';
import type {
  ImportPreviewResult,
  ImportProgressUpdate,
  ImportProcessResult,
  WeeklyReport,
} from '../../types/weeklyReport';

type WizardStep = 'upload' | 'preview' | 'importing' | 'results';

interface WeeklyImportWizardProps {
  /** Callback when import completes successfully */
  onComplete?: (result: ImportProcessResult) => void;
  /** Callback when wizard is cancelled */
  onCancel?: () => void;
}

/**
 * 🟢 WORKING: Multi-step wizard for weekly report imports
 */
export function WeeklyImportWizard({ onComplete, onCancel: _onCancel }: WeeklyImportWizardProps) {
  const { currentUser } = useAuth();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportProcessResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressUpdate | null>(null);
  const [_reportId, setReportId] = useState<string | null>(null);

  // Loading and error states
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Progress overlay phase
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);

  // Progress polling
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 🟢 WORKING: Clean up progress polling on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // 🟢 WORKING: Handle file selection - auto-parse on select
  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];

    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
      setError('Only Excel files (.xlsx, .xls) are allowed');
      toast.error('Only Excel files (.xlsx, .xls) are allowed');
      setSelectedFile(null);
      return;
    }

    setError(null);
    setSelectedFile(file);
    setImportPhase('parsing');

    // Auto-parse immediately after selection
    if (!currentUser?.id) {
      setError('User not authenticated');
      setImportPhase(null);
      return;
    }

    setIsParsing(true);

    try {
      // Use FormData for efficient file upload
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/noc/import/weekly/parse', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = typeof errorData.error === 'object'
          ? errorData.error?.message || JSON.stringify(errorData.error)
          : errorData.error || 'Failed to parse file';
        throw new Error(errorMsg);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to parse file');
      }

      setPreviewData(result.data);
      setCurrentStep('preview');
      toast.success(`Parsed ${result.data.total_rows} rows from ${file.name}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to parse file';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsParsing(false);
      setImportPhase(null);
    }
  }, [currentUser]);

  // 🟢 WORKING: Start import process
  const handleStartImport = useCallback(async () => {
    if (!selectedFile || !currentUser?.id || !previewData) {
      return;
    }

    setIsImporting(true);
    setError(null);
    setCurrentStep('importing');
    setImportPhase('uploading');

    try {
      // Use FormData for efficient file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('user_id', currentUser.id);

      // Show processing phase after short delay
      setTimeout(() => setImportPhase('processing'), 500);

      // Create weekly report and start import
      const response = await fetch('/api/noc/import/weekly', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Handle nested error structure: {error: {code, message, details}}
        const errorMsg = typeof errorData.error === 'object'
          ? errorData.error?.message || JSON.stringify(errorData.error)
          : errorData.error || 'Failed to start import';
        throw new Error(errorMsg);
      }

      const result = await response.json();

      if (!result.success) {
        // Handle nested error structure
        const errorMsg = typeof result.error === 'object'
          ? result.error?.message || JSON.stringify(result.error)
          : result.error || 'Failed to start import';
        throw new Error(errorMsg);
      }

      const report: WeeklyReport = result.data;
      setReportId(report.id);

      // Show syncing phase
      setImportPhase('syncing');

      // Start polling for progress
      startProgressPolling(report.id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start import';
      setError(errorMsg);
      toast.error(errorMsg);
      setCurrentStep('preview');
      setIsImporting(false);
      setImportPhase(null);
    }
  }, [selectedFile, currentUser, previewData]);

  // 🟢 WORKING: Poll for import progress
  const startProgressPolling = useCallback((id: string) => {
    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    // Poll every 2 seconds
    progressIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/noc/import/weekly/${id}/progress`);

        if (!response.ok) {
          throw new Error('Failed to fetch progress');
        }

        const result = await response.json();

        if (result.success) {
          const progress: ImportProgressUpdate = result.data;
          setImportProgress(progress);

          // Check if import is complete - check BOTH status AND percentage
          // Status check is critical for when all rows are duplicates (0 imported = 0% progress)
          const isComplete = progress.progress_percentage >= 100 ||
                            (result.data.status === 'completed') ||
                            (result.data.status === 'failed');

          if (isComplete) {
            // Stop polling
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }

            // Show complete phase briefly
            setImportPhase('complete');
            await new Promise(resolve => setTimeout(resolve, 800));

            // Fetch final results
            fetchImportResults(id);
          }
        }
      } catch {
        // Silent fail - keep polling
      }
    }, 2000);
  }, []);

  // 🟢 WORKING: Fetch final import results
  const fetchImportResults = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/noc/import/weekly/${id}`);

      if (!response.ok) {
        throw new Error('Failed to fetch results');
      }

      const result = await response.json();

      if (result.success) {
        const finalResult: ImportProcessResult = {
          report_id: id,
          status: result.data.status,
          total_rows: result.data.total_rows || 0,
          imported_count: result.data.imported_count || 0,
          skipped_count: result.data.skipped_count || 0,
          error_count: result.data.error_count || 0,
          errors: result.data.errors || [],
          duration_seconds: 0,
          tickets_created: [],
        };

        setImportResult(finalResult);
        setCurrentStep('results');
        setIsImporting(false);
        setImportPhase(null);

        // Calculate duplicates (total - imported - errors)
        const duplicateCount = Math.max(0, finalResult.total_rows - finalResult.imported_count - finalResult.error_count);
        const allDuplicates = finalResult.imported_count === 0 && duplicateCount > 0;
        const hasErrors = finalResult.error_count > 0;

        // Show success toast with import stats
        toast.custom(
          (t) => (
            <div
              className={`${
                t.visible ? 'animate-enter' : 'animate-leave'
              } max-w-md w-full bg-card shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
            >
              <div className="flex-1 w-0 p-4">
                <div className="flex items-start">
                  <div className="flex-shrink-0 pt-0.5">
                    {hasErrors ? (
                      <AlertCircle className="h-10 w-10 text-yellow-500" />
                    ) : (
                      <CheckCircle className="h-10 w-10 text-green-500" />
                    )}
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {hasErrors ? 'Import Complete with Warnings' : 'Weekly Import Complete'}
                    </p>
                    <div className="mt-2 space-y-1">
                      {finalResult.imported_count > 0 && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Database className="h-4 w-4 text-green-500" />
                          <span>{finalResult.imported_count} new tickets created</span>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        </div>
                      )}
                      {duplicateCount > 0 && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <FileCheck className="h-4 w-4 text-blue-400" />
                          <span>{duplicateCount} duplicates updated</span>
                        </div>
                      )}
                      {allDuplicates && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle className="h-4 w-4 text-blue-500" />
                          <span>All tickets already exist</span>
                        </div>
                      )}
                      {finalResult.error_count > 0 && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <XCircle className="h-4 w-4 text-red-500" />
                          <span>{finalResult.error_count} errors</span>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {finalResult.total_rows.toLocaleString()} total rows processed
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex border-l border-border">
                <button
                  onClick={() => toast.dismiss(t.id)}
                  className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 focus:outline-none"
                >
                  Close
                </button>
              </div>
            </div>
          ),
          { duration: 6000 }
        );

        onComplete?.(finalResult);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch results';
      setError(errorMsg);
      toast.error(errorMsg);
      setIsImporting(false);
      setImportPhase(null);
    }
  }, [onComplete]);

  // 🟢 WORKING: Reset wizard to start over
  const handleReset = useCallback(() => {
    setCurrentStep('upload');
    setSelectedFile(null);
    setPreviewData(null);
    setImportResult(null);
    setImportProgress(null);
    setReportId(null);
    setError(null);
    setIsParsing(false);
    setIsImporting(false);
    setImportPhase(null);

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // 🟢 WORKING: Go back to previous step
  const handleBack = useCallback(() => {
    if (currentStep === 'preview') {
      setCurrentStep('upload');
      setPreviewData(null);
      setError(null);
    }
  }, [currentStep]);

  return (
    <div className="space-y-6">
      {/* Import Progress Overlay */}
      <ImportProgressOverlay
        isVisible={importPhase !== null}
        phase={importPhase || 'parsing'}
        title="Weekly Report Import"
        recordCount={previewData?.total_rows || undefined}
        showDatabaseSync={true}
        showQFieldSync={false}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Weekly Report Import</h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {currentStep === 'upload' && 'Upload and parse Excel file'}
            {currentStep === 'preview' && 'Review and validate data before import'}
            {currentStep === 'importing' && 'Importing tickets from report'}
            {currentStep === 'results' && 'Import completed'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          <StepIndicator step={1} current={currentStep === 'upload'} completed={currentStep !== 'upload'} label="Upload" />
          <div className="w-8 h-0.5 bg-[var(--ff-border-light)]" />
          <StepIndicator step={2} current={currentStep === 'preview'} completed={['importing', 'results'].includes(currentStep)} label="Preview" />
          <div className="w-8 h-0.5 bg-[var(--ff-border-light)]" />
          <StepIndicator step={3} current={currentStep === 'importing'} completed={currentStep === 'results'} label="Import" />
          <div className="w-8 h-0.5 bg-[var(--ff-border-light)]" />
          <StepIndicator step={4} current={currentStep === 'results'} completed={false} label="Results" />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Step Content */}
      <div className="min-h-[400px]">
        {currentStep === 'upload' && (
          <FileUploadStep
            selectedFile={selectedFile}
            onFileChange={handleFileChange}
            isParsing={isParsing}
          />
        )}

        {currentStep === 'preview' && previewData && (
          <PreviewStep
            preview={previewData}
            onBack={handleBack}
            onImport={handleStartImport}
            isImporting={isImporting}
          />
        )}

        {currentStep === 'importing' && (
          <ImportingStep progress={importProgress} />
        )}

        {currentStep === 'results' && importResult && (
          <ResultsStep result={importResult} onReset={handleReset} />
        )}
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Step indicator component
 */
function StepIndicator({
  step,
  current,
  completed,
  label,
}: {
  step: number;
  current: boolean;
  completed: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all',
          current
            ? 'bg-blue-600 text-white'
            : completed
              ? 'bg-green-600 text-white'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
        )}
      >
        {completed ? <CheckCircle className="w-4 h-4" /> : step}
      </div>
      <span className={cn('text-xs', current ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-tertiary)]')}>
        {label}
      </span>
    </div>
  );
}

/**
 * 🟢 WORKING: File upload step component
 * Auto-parses on file selection for streamlined workflow
 */
function FileUploadStep({
  selectedFile,
  onFileChange,
  isParsing,
}: {
  selectedFile: File | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isParsing: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      <div className="w-24 h-24 rounded-full bg-blue-500/10 flex items-center justify-center">
        <FileSpreadsheet className="w-12 h-12 text-blue-400" />
      </div>

      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">Upload Weekly Report</h3>
        <p className="text-sm text-[var(--ff-text-secondary)] max-w-md">
          Select an Excel file (.xlsx or .xls) containing weekly ticket data - it will be parsed automatically
        </p>
      </div>

      {/* File Input */}
      <div className="w-full max-w-md">
        <label
          htmlFor="file-upload"
          className={cn(
            "flex flex-col items-center gap-4 p-8 border-2 border-dashed rounded-lg cursor-pointer transition-all",
            isParsing
              ? "border-blue-500/50 bg-blue-500/5"
              : "border-[var(--ff-border-light)] hover:border-blue-500/50 hover:bg-[var(--ff-bg-tertiary)]"
          )}
        >
          {isParsing ? (
            <InlineSpinner size="lg" />
          ) : (
            <Upload className="w-8 h-8 text-[var(--ff-text-tertiary)]" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {isParsing
                ? `Parsing ${selectedFile?.name}...`
                : selectedFile
                  ? selectedFile.name
                  : 'Choose file or drag and drop'}
            </p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              {isParsing ? 'Please wait...' : 'Excel files only (.xlsx, .xls)'}
            </p>
          </div>
          <input
            id="file-upload"
            type="file"
            accept=".xlsx,.xls"
            onChange={onFileChange}
            className="hidden"
            aria-label="Choose file"
            disabled={isParsing}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Preview step component
 */
function PreviewStep({
  preview,
  onBack,
  onImport,
  isImporting,
}: {
  preview: ImportPreviewResult;
  onBack: () => void;
  onImport: () => void;
  isImporting: boolean;
}) {
  return (
    <div className="space-y-6">
      <ImportPreview preview={preview} />

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--ff-border-light)]">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          type="button"
          onClick={onImport}
          disabled={!preview.can_proceed || isImporting}
          className={cn(
            'px-6 py-2.5 rounded-lg text-sm font-medium transition-all',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            preview.can_proceed
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
          )}
        >
          {isImporting ? (
            <span className="flex items-center gap-2">
              <InlineSpinner size="sm" />
              <span>Starting Import...</span>
            </span>
          ) : (
            `Import ${preview.valid_rows} Tickets`
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Importing step component
 */
function ImportingStep({ progress }: { progress: ImportProgressUpdate | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-6">
      <div className="w-24 h-24 rounded-full bg-blue-500/10 flex items-center justify-center">
        <LoadingSpinner size="xl" label="" />
      </div>

      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">Importing Tickets</h3>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Please wait while we import tickets from the weekly report
        </p>
      </div>

      {/* Progress Bar */}
      {progress && (
        <div className="w-full max-w-md space-y-3">
          <div className="relative h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-blue-600 transition-all duration-300"
              style={{ width: `${progress.progress_percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--ff-text-secondary)]">
              {progress.processed_rows} / {progress.total_rows} rows
            </span>
            <span className="text-[var(--ff-text-primary)] font-medium">{progress.progress_percentage}%</span>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
              <p className="text-xs text-[var(--ff-text-tertiary)]">Imported</p>
              <p className="text-lg font-semibold text-green-400">{progress.imported_count}</p>
            </div>
            <div className="p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
              <p className="text-xs text-[var(--ff-text-tertiary)]">Errors</p>
              <p className="text-lg font-semibold text-red-400">{progress.error_count}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Results step component
 */
function ResultsStep({
  result,
  onReset,
}: {
  result: ImportProcessResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-6">
      <ImportResults result={result} />

      {/* Actions */}
      <div className="flex items-center justify-center pt-4 border-t border-[var(--ff-border-light)]">
        <button
          type="button"
          onClick={onReset}
          className="px-6 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-all flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Import Another Report</span>
        </button>
      </div>
    </div>
  );
}
