/**
 * Staff Import Advanced Hook
 * Custom hook for advanced staff import functionality
 */

import { useState, useCallback } from 'react';
import { notificationService } from '@/services/core/NotificationService';
import { staffImportService } from '@/services/staff/staffImportService';
import { StaffImportAdvancedState, ImportProgress } from '../types/importAdvanced.types';
import { validateImportFile, getFileTypeFromFile } from '../utils/importUtils';
import { log } from '@/lib/logger';

const initialProgress: ImportProgress = {
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  status: 'idle'
};

const initialState: StaffImportAdvancedState = {
  selectedFile: null,
  importing: false,
  progress: initialProgress,
  importResult: null,
  overwriteExisting: true
};

export function useStaffImportAdvanced() {
  const [state, setState] = useState<StaffImportAdvancedState>(initialState);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = validateImportFile(file);
    if (!validation.valid) {
      notificationService.error(validation.error || 'Invalid file');
      return;
    }

    setState(prev => ({
      ...prev,
      selectedFile: file,
      importResult: null,
      progress: initialProgress
    }));
  }, []);

  const handleImport = async () => {
    if (!state.selectedFile) {
      notificationService.error('Please select a file first');
      return;
    }

    setState(prev => ({ 
      ...prev, 
      importing: true,
      progress: { ...prev.progress, status: 'parsing' }
    }));

    try {
      const fileType = getFileTypeFromFile(state.selectedFile);
      let result;

      if (fileType === 'csv') {

        result = await staffImportService.importFromCSV(state.selectedFile, state.overwriteExisting);
      } else if (fileType === 'excel') {

        result = await staffImportService.importFromExcel(state.selectedFile, state.overwriteExisting);
      } else {
        throw new Error('Unsupported file type. Please use CSV or Excel files.');
      }

      setState(prev => ({
        ...prev,
        importResult: result,
        progress: {
          total: result.imported + result.failed,
          processed: result.imported + result.failed,
          succeeded: result.imported,
          failed: result.failed,
          status: 'completed'
        }
      }));

      if (result.success) {
        notificationService.success(`Successfully imported ${result.imported} staff members`);
      } else {
        notificationService.warning(`Import completed with ${result.failed} errors. Check details below.`);
      }

    } catch (error: unknown) {
      log.error('Import failed:', { data: error }, 'useStaffImportAdvanced');
      setState(prev => ({
        ...prev,
        progress: { ...prev.progress, status: 'error' }
      }));
      notificationService.operationError('import', error instanceof Error ? error.message : 'Unknown error', 'staff data');
    } finally {
      setState(prev => ({ ...prev, importing: false }));
    }
  };

  const downloadTemplate = () => {
    const template = staffImportService.getImportTemplate();
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'staff-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notificationService.success('Template downloaded');
  };

  const clearFile = () => {
    setState(prev => ({
      ...prev,
      selectedFile: null,
      importResult: null,
      progress: initialProgress
    }));
  };

  const setOverwriteExisting = (overwrite: boolean) => {
    setState(prev => ({ ...prev, overwriteExisting: overwrite }));
  };

  return {
    ...state,
    handleFileSelect,
    handleImport,
    downloadTemplate,
    clearFile,
    setOverwriteExisting
  };
}