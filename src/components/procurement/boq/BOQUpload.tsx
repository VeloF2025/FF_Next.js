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
}: BOQUploadProps) {
  const { context } = useProcurementContext();
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
    if (!state.file || !context) {
      notificationService.error('Please select a file and ensure project context is available');
      return;
    }

    // Enhanced import: detect columns first
    if (enableEnhancedImport) {
      await detectColumns();
      return;
    }

    // Legacy import path (unchanged)
    setState(prev => ({ ...prev, isUploading: true, progress: 0, stage: 'Starting...', message: '' }));

    try {
      const boqId = context.projectId || `temp-${Date.now()}`;

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
    if (!state.file || !context?.projectId || !state.detection) return;

    setState(prev => ({ ...prev, isUploading: true, stage: 'Importing...', progress: 30 }));

    try {
      const formData = new FormData();
      formData.append('file', state.file);
      formData.append('projectId', context.projectId);
      formData.append('columnMapping', JSON.stringify(confirmedMapping));
      formData.append('sheetName', state.detection.sheetName);
      formData.append('headerRow', String(state.detection.headerRow));
      formData.append('createBudgetItems', String(createBudgetItems));
      formData.append('createMaterials', String(createMaterials));

      if (saveTemplate) {
        formData.append('saveAsTemplate', JSON.stringify(saveTemplate));
      }

      const response = await fetch('/api/procurement/boq/import-mapped', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Import failed');
      }

      const result = data.data;

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
            className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
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
