/**
 * BOQ Upload Component
 * Handles Excel/CSV file upload with smart column detection and mapping review.
 * Flow: Upload → Detect Columns → Review Mapping → Import
 */

import { useState, useCallback, useRef } from 'react';
import { validateFile } from '@/lib/utils/excelParser';
import { BOQImportService, ImportJob, ImportConfig } from '@/services/procurement/boqImportService';
import { useProcurementContext } from '@/hooks/procurement/useProcurementContext';
import { notificationService } from '@/services/core/NotificationService';
import type { ColumnMapping, ColumnDetectionResult } from '@/types/procurement/boq.types';

// Import split components
import { BOQUploadDropzone } from './upload/BOQUploadDropzone';
import { BOQUploadConfig } from './upload/BOQUploadConfig';
import { BOQUploadProgress } from './upload/BOQUploadProgress';
import BOQColumnMapper from './BOQColumnMapper';

interface EnhancedImportResult {
  boqId: string;
  itemsCreated: number;
  exceptionsCreated: number;
  materialsMatched?: number;
  materialsCreated?: number;
  budgetItemsCreated?: number;
  totalBudgetAmount?: number;
  stockItemsMatched?: number;
}

interface BOQUploadProps {
  onUploadComplete?: (result: EnhancedImportResult) => void;
  onUploadError?: (error: string) => void;
  className?: string;
  /** Enable enhanced import with material catalog and budget item creation */
  enableEnhancedImport?: boolean;
  /** Create budget items when using enhanced import (default: true) */
  createBudgetItems?: boolean;
  /** Create new materials in catalog when using enhanced import (default: true) */
  createMaterials?: boolean;
  /** Explicit project ID — overrides context when provided */
  projectId?: string;
  /** BOQ title — passed to import service */
  title?: string;
}

interface UploadState {
  file: File | null;
  job: ImportJob | null;
  isUploading: boolean;
  isDetecting: boolean;
  progress: number;
  stage: string;
  message: string;
  config: Partial<ImportConfig>;
  detection: ColumnDetectionResult | null;
}

const INITIAL_STATE: UploadState = {
  file: null,
  job: null,
  isUploading: false,
  isDetecting: false,
  progress: 0,
  stage: '',
  message: '',
  config: {
    autoApprove: false,
    strictValidation: false,
    minMappingConfidence: 0.8,
    createNewItems: false,
    duplicateHandling: 'skip'
  },
  detection: null,
};

export default function BOQUpload({
  onUploadComplete,
  onUploadError,
  className,
  enableEnhancedImport = false,
  createBudgetItems = true,
  createMaterials = true,
  projectId: propProjectId,
  title: propTitle,
}: BOQUploadProps) {
  const { context } = useProcurementContext();
  // Use explicit projectId prop, falling back to context
  const effectiveProjectId = propProjectId || context?.projectId;
  const [state, setState] = useState<UploadState>(INITIAL_STATE);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  // Create service instance for legacy import
  const boqImportService = new BOQImportService();

  const handleFileSelect = useCallback((file: File) => {
    const validation = validateFile(file);

    if (!validation.valid) {
      notificationService.error(validation.error || 'Invalid file');
      onUploadError?.(validation.error || 'Invalid file');
      return;
    }

    setState(prev => ({ ...prev, file, detection: null }));
  }, [onUploadError]);

  const handleConfigChange = (newConfig: Partial<ImportConfig>) => {
    setState(prev => ({
      ...prev,
      config: { ...prev.config, ...newConfig }
    }));
  };

  /**
   * Start import: detect columns first when enhanced import is enabled
   */
  const startUpload = async () => {
    if (!state.file) {
      notificationService.error('Please select a file');
      return;
    }

    // Enhanced import: detect columns first (doesn't need project context yet)
    if (enableEnhancedImport) {
      await detectColumns();
      return;
    }

    // Legacy import requires project context
    if (!effectiveProjectId) {
      notificationService.error('Please select a project');
      return;
    }

    // Legacy import path (unchanged)
    setState(prev => ({ ...prev, isUploading: true, progress: 0, stage: 'Starting...', message: '' }));

    try {
      const boqId = effectiveProjectId || `temp-${Date.now()}`;

      const job = await boqImportService.startImport(
        boqId,
        state.file,
        {
          ...state.config,
          progressCallback: (progress) => {
            setState(prev => ({
              ...prev,
              progress: progress.progress,
              stage: progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1),
              message: progress.message || ''
            }));

            if (progressRef.current) {
              progressRef.current.style.width = `${progress.progress}%`;
            }
          }
        }
      );

      setState(prev => ({ ...prev, job }));

      const pollJob = setInterval(() => {
        const currentJob = boqImportService.getJob(job.id);
        if (currentJob) {
          setState(prev => ({ ...prev, job: currentJob }));

          if (currentJob.status === 'completed' && currentJob.result) {
            clearInterval(pollJob);
            setTimeout(() => {
              const result = currentJob.result!;
              notificationService.success(`BOQ imported successfully! ${result.itemsCreated || result.stats.validRows} items created`);
              onUploadComplete?.({
                boqId: result.boqId || boqId,
                itemsCreated: result.itemsCreated || result.stats.validRows,
                exceptionsCreated: result.exceptionsCreated || result.stats.errorRows
              });
              setState(INITIAL_STATE);
            }, 500);
          } else if (currentJob.status === 'failed') {
            clearInterval(pollJob);
            notificationService.error(`Import failed: ${currentJob.error}`);
            onUploadError?.(currentJob.error || 'Import failed');
            setState(prev => ({ ...prev, isUploading: false }));
          }
        }
      }, 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      notificationService.error(errorMessage);
      onUploadError?.(errorMessage);
      setState(prev => ({ ...prev, isUploading: false }));
    }
  };

  /**
   * Step 1: Detect columns from uploaded file
   */
  const detectColumns = async () => {
    if (!state.file) return;

    setState(prev => ({ ...prev, isDetecting: true, stage: 'Analyzing columns...' }));

    try {
      const formData = new FormData();
      formData.append('file', state.file);

      const response = await fetch('/api/procurement/boq/detect-columns', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Column detection failed');
      }

      const detection: ColumnDetectionResult = data.data;

      setState(prev => ({
        ...prev,
        isDetecting: false,
        detection,
      }));

      if (detection.templateMatch) {
        notificationService.info(
          `Matched template "${detection.templateMatch.name}"${detection.templateMatch.supplierName ? ` (${detection.templateMatch.supplierName})` : ''}`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Column detection failed';
      notificationService.error(errorMessage);
      onUploadError?.(errorMessage);
      setState(prev => ({ ...prev, isDetecting: false }));
    }
  };

  /**
   * Step 2: User confirmed mapping → import with mapped columns
   */
  const handleMappingConfirm = async (
    confirmedMapping: ColumnMapping[],
    saveTemplate?: { name: string; supplierName?: string }
  ) => {
    if (!state.file || !effectiveProjectId || !state.detection) {
      notificationService.error('Missing file, project, or column detection data');
      return;
    }

    setState(prev => ({ ...prev, isUploading: true, stage: 'Importing...', progress: 30, message: 'Processing file and creating BOQ items. This may take a minute for large files...' }));

    try {
      const formData = new FormData();
      formData.append('file', state.file);
      formData.append('projectId', effectiveProjectId);
      formData.append('columnMapping', JSON.stringify(confirmedMapping));
      formData.append('sheetName', state.detection.sheetName);
      formData.append('headerRow', String(state.detection.headerRow));
      formData.append('createBudgetItems', String(createBudgetItems));
      formData.append('createMaterials', String(createMaterials));
      if (propTitle) {
        formData.append('title', propTitle);
      }

      if (saveTemplate) {
        formData.append('saveAsTemplate', JSON.stringify(saveTemplate));
      }

      // Use AbortController with 90s timeout to handle Cloudflare tunnel issues
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90_000);

      let result: any;
      let fetchSucceeded = false;

      try {
        const response = await fetch('/api/procurement/boq/import-mapped', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 524) {
            // Cloudflare timeout — fall through to polling
          } else {
            throw new Error(data.error?.message || 'Import failed');
          }
        } else {
          result = data.data;
          fetchSucceeded = true;
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        // AbortError or network error — the server may have processed the import
        // but Cloudflare tunnel didn't deliver the response. Fall through to polling.
        if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError') &&
            !(fetchError instanceof TypeError)) {
          throw fetchError;
        }
      }

      // If fetch didn't return a result, poll to check if import completed server-side
      if (!fetchSucceeded) {
        setState(prev => ({ ...prev, progress: 60, message: 'Verifying import status...' }));
        // Wait a moment then check if a BOQ was created recently
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          const checkRes = await fetch(`/api/procurement/boq?projectId=${effectiveProjectId}`);
          const checkData = await checkRes.json();
          const boqs = checkData.data?.boqs || checkData.boqs || [];
          const latestBoq = boqs[0]; // sorted by created_at DESC
          if (latestBoq && latestBoq.title === propTitle) {
            result = {
              boqId: latestBoq.id,
              itemsProcessed: latestBoq.itemCount || latestBoq.item_count || 0,
              stockItemsMatched: 0,
              budgetItemsCreated: 0,
            };
            fetchSucceeded = true;
          }
        } catch {
          // Polling failed too
        }
      }

      if (!fetchSucceeded) {
        throw new Error(
          'Import response not received, but the import may have completed. Check the BOQ list to verify.'
        );
      }

      // Build success message
      const details = [];
      if (result.materialsMatched > 0) details.push(`${result.materialsMatched} materials matched`);
      if (result.materialsCreated > 0) details.push(`${result.materialsCreated} new materials`);
      if (result.budgetItemsCreated > 0) details.push(`${result.budgetItemsCreated} budget items`);
      if (result.stockItemsMatched > 0) details.push(`${result.stockItemsMatched} stock items linked`);

      notificationService.success(
        `BOQ imported! ${result.itemsProcessed} items${details.length ? ` (${details.join(', ')})` : ''}`
      );

      onUploadComplete?.({
        boqId: result.boqId,
        itemsCreated: result.itemsProcessed,
        exceptionsCreated: result.errors?.length || 0,
        materialsMatched: result.materialsMatched,
        materialsCreated: result.materialsCreated,
        budgetItemsCreated: result.budgetItemsCreated,
        totalBudgetAmount: result.totalBudgetAmount,
        stockItemsMatched: result.stockItemsMatched,
      });

      setState(INITIAL_STATE);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      notificationService.error(errorMessage);
      onUploadError?.(errorMessage);
      setState(prev => ({ ...prev, isUploading: false }));
    }
  };

  const handleMappingCancel = () => {
    setState(prev => ({ ...prev, detection: null }));
  };

  const cancelUpload = () => {
    if (state.job?.id) {
      boqImportService.cancelJob(state.job.id);
      notificationService.info('Import cancelled');
    }
    setState(INITIAL_STATE);
  };

  const handleFileRemove = () => {
    setState(prev => ({ ...prev, file: null, detection: null }));
  };

  // Show column mapper when detection is ready
  if (state.detection && !state.isUploading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <BOQColumnMapper
          detection={state.detection}
          onConfirm={handleMappingConfirm}
          onCancel={handleMappingCancel}
          isImporting={state.isUploading}
        />
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Upload Area */}
      <BOQUploadDropzone
        file={state.file}
        isUploading={state.isUploading || state.isDetecting}
        onFileSelect={handleFileSelect}
        onFileRemove={handleFileRemove}
      />

      {/* Advanced Configuration */}
      {state.file && !state.isUploading && !state.isDetecting && (
        <BOQUploadConfig
          config={state.config}
          showAdvanced={showAdvanced}
          onConfigChange={handleConfigChange}
          onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
        />
      )}

      {/* Upload/Detection Progress */}
      {(state.isUploading || state.isDetecting) && (
        <BOQUploadProgress
          job={state.job}
          progress={state.isDetecting ? 50 : state.progress}
          stage={state.stage}
          message={state.isDetecting ? 'Analyzing file structure and detecting columns...' : state.message}
          onCancel={cancelUpload}
        />
      )}

      {/* Upload Button */}
      {state.file && !state.isUploading && !state.isDetecting && (
        <div className="flex justify-end space-x-3">
          <button
            onClick={handleFileRemove}
            className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] rounded-md hover:bg-[var(--ff-bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={startUpload}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            {enableEnhancedImport ? 'Detect Columns & Import' : 'Start Import'}
          </button>
        </div>
      )}
    </div>
  );
}
