import { useState } from 'react';
// xlsx is loaded dynamically inside downloadTemplate to avoid bundle cost at page load
import { useSOWService } from '@/hooks/useSOW';
import { sowDataProcessor } from '@/services/sowDataProcessor';
import { neonSOWService } from '@/services/neonSOWService';
import { SOWFile, FileTypeConfig } from '../types/sowUpload.types';
import { log } from '@/lib/logger';

export function useSOWUpload(
  projectId: string,
  onDataUpdate?: (data: { poles?: any[]; drops?: any[]; fibre?: any[] }) => void
) {
  const [files, setFiles] = useState<SOWFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const sowService = useSOWService();

  const updateFileStatus = (
    type: string,
    status: SOWFile['status'],
    message?: string,
    data?: any[],
    summary?: SOWFile['summary']
  ) => {
    setFiles(prev => prev.map(f =>
      f.type === type
        ? { ...f, status, message, data, summary } as SOWFile
        : f
    ));
  };

  // Removed Firebase save function - data is now saved directly to Neon via API

  const processFile = async (sowFile: SOWFile) => {
    setIsProcessing(true);

    try {
      updateFileStatus(sowFile.type, 'processing', 'Reading file...');

      // Process file using sowDataProcessor for Lawley-format compatibility
      const rawData = await sowDataProcessor.processFile(sowFile.file, sowFile.type);

      if (!rawData || rawData.length === 0) {
        updateFileStatus(sowFile.type, 'error', 'File is empty or has invalid format');
        setIsProcessing(false);
        return;
      }

      updateFileStatus(sowFile.type, 'processing', 'Processing data...');

      // Process data based on type WITHOUT validation - just like the direct import
      let processedData: any[] = [];

      switch (sowFile.type) {
        case 'poles': {
          processedData = sowDataProcessor.processPoles(rawData);
          break;
        }
        case 'drops': {
          processedData = sowDataProcessor.processDrops(rawData);
          break;
        }
        case 'fibre': {
          processedData = sowDataProcessor.processFibre(rawData);
          break;
        }
      }

      if (processedData.length === 0) {
        updateFileStatus(sowFile.type, 'error', 'No data found in file');
        setIsProcessing(false);
        return;
      }

      // Initialize Neon tables if not exists
      updateFileStatus(sowFile.type, 'processing', 'Initializing database...');
      await neonSOWService.initializeTables(projectId);

      // Upload to Neon database
      updateFileStatus(sowFile.type, 'processing', `Uploading ${processedData.length} items to database...`);

      let uploadResult;
      switch (sowFile.type) {
        case 'poles':
          uploadResult = await neonSOWService.uploadPoles(projectId, processedData);
          break;
        case 'drops':
          uploadResult = await neonSOWService.uploadDrops(projectId, processedData);
          break;
        case 'fibre':
          uploadResult = await neonSOWService.uploadFibre(projectId, processedData);
          break;
      }

      // Data is now saved directly to Neon via API - no Firebase backup needed

      // Update status with success
      updateFileStatus(sowFile.type, 'success', uploadResult?.message || 'Data uploaded successfully', processedData, {
        total: rawData.length,
        valid: processedData.length,
        invalid: 0,
        warnings: undefined
      });

      // Update parent component
      if (onDataUpdate) {
        const currentData = files.reduce((acc, f) => {
          if (f.data) {
            acc[f.type] = f.data;
          }
          return acc;
        }, {} as any);

        currentData[sowFile.type] = processedData;
        onDataUpdate(currentData);
      }

    } catch (error) {
      log.error(`Error processing ${sowFile.type} file:`, { data: error }, 'useSOWUpload');
      updateFileStatus(sowFile.type, 'error', `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (type: 'poles' | 'drops' | 'fibre', event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Remove any existing file of the same type
    setFiles(prev => prev.filter(f => f.type !== type));

    // Add new file with pending status
    const newFile: SOWFile = {
      type,
      file,
      status: 'pending'
    };
    setFiles(prev => [...prev, newFile]);

    // Process the file
    await processFile(newFile);
  };

  const removeFile = (type: string) => {
    setFiles(prev => prev.filter(f => f.type !== type));
  };

  const downloadTemplate = async (fileType: FileTypeConfig) => {
    const XLSX = await import('xlsx');
    // Create workbook with sample data
    const ws = XLSX.utils.json_to_sheet(fileType.sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    // Download file
    XLSX.writeFile(wb, `${fileType.type}_template.xlsx`);
  };

  return {
    files,
    isProcessing,
    handleFileUpload,
    removeFile,
    downloadTemplate
  };
}