/**
 * WeeklyImportWizard Component - Multi-step wizard for weekly report imports
 *
 * 🟢 WORKING: Production-ready import wizard component
 *
 * Features:
 * - Step 1: File upload with validation
 * - Step 2: Preview parsed data with validation errors
 * - Step 3: Confirm and start import
 * - Step 4: Show import results
 * - Progress tracking during import
 * - Error handling at each step
 * - Navigation between steps
 */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImportPreview } from './ImportPreview';
import { ImportResults } from './ImportResults';
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
export function WeeklyImportWizard({ onComplete, onCancel }: WeeklyImportWizardProps) {
  const { currentUser } = useAuth();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportProcessResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressUpdate | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  // Loading and error states
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // 🟢 WORKING: Handle file selection
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
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
      setSelectedFile(null);
      return;
    }

    setError(null);
    setSelectedFile(file);
  }, []);

  // 🟢 WORKING: Parse uploaded file
  const handleParseFile = useCallback(async () => {
    if (!selectedFile || !currentUser?.id) {
      return;
    }

    setIsParsing(true);
    setError(null);

    try {
      // Read file as array buffer
      const buffer = await readFileAsArrayBuffer(selectedFile);

      // Send to API for parsing
      const response = await fetch('/api/ticketing/import/weekly/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: selectedFile.name,
          data: Array.from(new Uint8Array(buffer)),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Handle nested error structure: {error: {code, message, details}}
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsParsing(false);
    }
  }, [selectedFile, currentUser]);

  // 🟢 WORKING: Start import process
  const handleStartImport = useCallback(async () => {
    if (!selectedFile || !currentUser?.id || !previewData) {
      return;
    }

    setIsImporting(true);
    setError(null);
    setCurrentStep('importing');

    try {
      // Read file as array buffer
      const buffer = await readFileAsArrayBuffer(selectedFile);

      // Create weekly report and start import
      const response = await fetch('/api/ticketing/import/weekly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: selectedFile.name,
          data: Array.from(new Uint8Array(buffer)),
          user_id: currentUser.id,
        }),
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

      // Start polling for progress
      startProgressPolling(report.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import');
      setCurrentStep('preview');
      setIsImporting(false);
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
        const response = await fetch(`/api/ticketing/import/weekly/${id}/progress`);

        if (!response.ok) {
          throw new Error('Failed to fetch progress');
        }

        const result = await response.json();

        if (result.success) {
          const progress: ImportProgressUpdate = result.data;
          setImportProgress(progress);

          // Check if import is complete
          if (progress.progress_percentage >= 100) {
            // Stop polling
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
              progressIntervalRef.current = null;
            }

            // Fetch final results
            fetchImportResults(id);
          }
        }
      } catch (err) {
        // Silent fail - keep polling
      }
    }, 2000);
  }, []);

  // 🟢 WORKING: Fetch final import results
  const fetchImportResults = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/ticketing/import/weekly/${id}`);

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

        onComplete?.(finalResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch results');
      setIsImporting(false);
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
          <StepIndicator step={1} current={currentStep === 'upload'} label="Upload" />
          <div className="w-8 h-0.5 bg-[var(--ff-border-light)]" />
          <StepIndicator step={2} current={currentStep === 'preview'} label="Preview" />
          <div className="w-8 h-0.5 bg-[var(--ff-border-light)]" />
          <StepIndicator step={3} current={currentStep === 'importing'} label="Import" />
          <div className="w-8 h-0.5 bg-[var(--ff-border-light)]" />
          <StepIndicator step={4} current={currentStep === 'results'} label="Results" />
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
            onParse={handleParseFile}
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
  label,
}: {
  step: number;
  current: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all',
          current
            ? 'bg-blue-600 text-white'
            : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]'
        )}
      >
        {step}
      </div>
      <span className={cn('text-xs', current ? 'text-[var(--ff-text-primary)]' : 'text-[var(--ff-text-tertiary)]')}>
        {label}
      </span>
    </div>
  );
}

/**
 * 🟢 WORKING: File upload step component
 */
function FileUploadStep({
  selectedFile,
  onFileChange,
  onParse,
  isParsing,
}: {
  selectedFile: File | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onParse: () => void;
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
          Select an Excel file (.xlsx or .xls) containing weekly ticket data to upload and import
        </p>
      </div>

      {/* File Input */}
      <div className="w-full max-w-md">
        <label
          htmlFor="file-upload"
          className="flex flex-col items-center gap-4 p-8 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-blue-500/50 hover:bg-[var(--ff-bg-tertiary)] transition-all"
        >
          <Upload className="w-8 h-8 text-[var(--ff-text-tertiary)]" />
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">
              {selectedFile ? selectedFile.name : 'Choose file or drag and drop'}
            </p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Excel files only (.xlsx, .xls)</p>
          </div>
          <input
            id="file-upload"
            type="file"
            accept=".xlsx,.xls"
            onChange={onFileChange}
            className="hidden"
            aria-label="Choose file"
          />
        </label>
      </div>

      {/* Parse Button */}
      {selectedFile && (
        <button
          type="button"
          onClick={onParse}
          disabled={isParsing}
          className={cn(
            'px-6 py-2.5 rounded-lg text-sm font-medium transition-all',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'bg-blue-600 hover:bg-blue-700 text-white'
          )}
        >
          {isParsing ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Parsing File...</span>
            </span>
          ) : (
            'Parse File'
          )}
        </button>
      )}
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
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Starting Import...</span>
            </span>
          ) : (
            'Start Import'
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
        <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
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

/**
 * 🟢 WORKING: Read file as array buffer
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      if (event.target?.result instanceof ArrayBuffer) {
        resolve(event.target.result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsArrayBuffer(file);
  });
}
