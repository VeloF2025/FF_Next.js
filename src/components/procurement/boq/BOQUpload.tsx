/**
 * BOQ Upload Component
 * Handles Excel/CSV file upload with drag-drop interface and progress tracking
 */

import { useState, useCallback, useRef } from 'react';
import { validateFile } from '@/lib/utils/excelParser';
import { BOQImportService, ImportJob, ImportConfig } from '@/services/procurement/boqImportService';
import { useProcurementContext } from '@/hooks/procurement/useProcurementContext';
import { notificationService } from '@/services/core/NotificationService';

// Import split components
import { BOQUploadDropzone } from './upload/BOQUploadDropzone';
import { BOQUploadConfig } from './upload/BOQUploadConfig';
import { BOQUploadProgress } from './upload/BOQUploadProgress';

interface EnhancedImportResult {
  boqId: string;
  itemsCreated: number;
  exceptionsCreated: number;
  materialsMatched?: number;
  materialsCreated?: number;
  budgetItemsCreated?: number;
  totalBudgetAmount?: number;
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
  progress: number;
  stage: string;
  message: string;
  config: Partial<ImportConfig>;
}

const INITIAL_STATE: UploadState = {
  file: null,
  job: null,
  isUploading: false,
  progress: 0,
  stage: '',
  message: '',
  config: {
    autoApprove: false,
    strictValidation: false,
    minMappingConfidence: 0.8,
    createNewItems: false,
    duplicateHandling: 'skip'
  }
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

    setState(prev => ({ ...prev, file }));
  }, [onUploadError]);

  const handleConfigChange = (newConfig: Partial<ImportConfig>) => {
    setState(prev => ({
      ...prev,
      config: { ...prev.config, ...newConfig }
    }));
  };

  const startUpload = async () => {
    if (!state.file || !context) {
      notificationService.error('Please select a file and ensure project context is available');
      return;
    }

    setState(prev => ({ ...prev, isUploading: true, progress: 0, stage: 'Starting...', message: '' }));

    try {
      // Use enhanced import if enabled
      if (enableEnhancedImport) {
        await startEnhancedUpload();
        return;
      }

      // Legacy import using local service
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
   * Enhanced upload using server-side API with material matching
   */
  const startEnhancedUpload = async () => {
    if (!state.file || !context?.projectId) {
      notificationService.error('Please select a file and ensure project context is available');
      setState(prev => ({ ...prev, isUploading: false }));
      return;
    }

    setState(prev => ({ ...prev, stage: 'Uploading file...', progress: 10 }));

    try {
      const formData = new FormData();
      formData.append('file', state.file);
      formData.append('projectId', context.projectId);
      formData.append('createBudgetItems', String(createBudgetItems));
      formData.append('createMaterials', String(createMaterials));

      const response = await fetch('/api/procurement/boq/import-enhanced', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Import failed');
      }

      const result = data.data;

      // Show success with enhanced details
      const details = [];
      if (result.materialsCreated > 0) details.push(`${result.materialsCreated} materials added`);
      if (result.budgetItemsCreated > 0) details.push(`${result.budgetItemsCreated} budget items`);

      notificationService.success(
        `BOQ imported! ${result.itemsProcessed} items processed${details.length ? ` (${details.join(', ')})` : ''}`
      );

      onUploadComplete?.({
        boqId: result.boqId,
        itemsCreated: result.itemsProcessed,
        exceptionsCreated: result.errors?.length || 0,
        materialsMatched: result.materialsMatched,
        materialsCreated: result.materialsCreated,
        budgetItemsCreated: result.budgetItemsCreated,
        totalBudgetAmount: result.totalBudgetAmount,
      });

      setState(INITIAL_STATE);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Enhanced import failed';
      notificationService.error(errorMessage);
      onUploadError?.(errorMessage);
      setState(prev => ({ ...prev, isUploading: false }));
    }
  };

  const cancelUpload = () => {
    if (state.job?.id) {
      boqImportService.cancelJob(state.job.id);
      notificationService.info('Import cancelled');
    }
    setState(INITIAL_STATE);
  };

  const handleFileRemove = () => {
    setState(prev => ({ ...prev, file: null }));
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Upload Area */}
      <BOQUploadDropzone
        file={state.file}
        isUploading={state.isUploading}
        onFileSelect={handleFileSelect}
        onFileRemove={handleFileRemove}
      />

      {/* Advanced Configuration */}
      {state.file && !state.isUploading && (
        <BOQUploadConfig
          config={state.config}
          showAdvanced={showAdvanced}
          onConfigChange={handleConfigChange}
          onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
        />
      )}

      {/* Upload Progress */}
      {state.isUploading && (
        <BOQUploadProgress
          job={state.job}
          progress={state.progress}
          stage={state.stage}
          message={state.message}
          onCancel={cancelUpload}
        />
      )}

      {/* Upload Button */}
      {state.file && !state.isUploading && (
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
            Start Import
          </button>
        </div>
      )}
    </div>
  );
}
