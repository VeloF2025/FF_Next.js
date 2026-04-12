import { useState } from 'react';
// xlsx is loaded dynamically inside downloadTemplate to avoid bundle cost at page load
import { useSOWService } from '@/hooks/useSOW';
import { sowDataProcessor } from '@/services/sowDataProcessor';
import { neonSOWService } from '@/services/neonSOWService';
import { SOWFile, FileTypeConfig } from '../types/sowUpload.types';
import type { NeonPoleData, NeonDropData, NeonFibreData } from '@/services/neonSOWService';
import { log } from '@/lib/logger';

type SOWDataUpdate = {
  poles?: NeonPoleData[];
  drops?: NeonDropData[];
  fibre?: NeonFibreData[];
};

type ProcessedSOWData = NeonPoleData[] | NeonDropData[] | NeonFibreData[];

export function useSOWUpload(
  projectId: string,
  onDataUpdate?: (data: SOWDataUpdate) => void
) {
  const [files, setFiles] = useState<SOWFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const sowService = useSOWService();

  const updateFileStatus = (
    type: string,
    status: SOWFile['status'],
    message?: string,
    data?: ProcessedSOWData,
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

      // Initialize Neon tables if not exists
      updateFileStatus(sowFile.type, 'processing', 'Initializing database...');
      await neonSOWService.initializeTables(projectId);

      // Process data based on type and upload in one switch to preserve narrowing
      let processedData: ProcessedSOWData;
      let uploadResult: { message?: string } | undefined;

      switch (sowFile.type) {
        case 'poles': {
          const poles = sowDataProcessor.processPoles(rawData);
          if (poles.length === 0) {
            updateFileStatus(sowFile.type, 'error', 'No data found in file');
            setIsProcessing(false);
            return;
          }
          updateFileStatus(sowFile.type, 'processing', `Uploading ${poles.length} items to database...`);
          uploadResult = await neonSOWService.uploadPoles(projectId, poles);
          processedData = poles;
          break;
        }
        case 'drops': {
          const drops = sowDataProcessor.processDrops(rawData);
          if (drops.length === 0) {
            updateFileStatus(sowFile.type, 'error', 'No data found in file');
            setIsProcessing(false);
            return;
          }
          updateFileStatus(sowFile.type, 'processing', `Uploading ${drops.length} items to database...`);
          uploadResult = await neonSOWService.uploadDrops(projectId, drops);
          processedData = drops;
          break;
        }
        case 'fibre': {
          const fibres = sowDataProcessor.processFibre(rawData);
          if (fibres.length === 0) {
            updateFileStatus(sowFile.type, 'error', 'No data found in file');
            setIsProcessing(false);
            return;
          }
          updateFileStatus(sowFile.type, 'processing', `Uploading ${fibres.length} items to database...`);
          uploadResult = await neonSOWService.uploadFibre(projectId, fibres);
          processedData = fibres;
          break;
        }
        default:
          setIsProcessing(false);
          return;
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
        const currentData = files.reduce<SOWDataUpdate>((acc, f) => {
          if (f.data) {
            // f.data is Record<string,unknown>[] from SOWFile; cast via unknown for type assignment
            acc[f.type] = f.data as unknown as NeonPoleData[] & NeonDropData[] & NeonFibreData[];
          }
          return acc;
        }, {});

        currentData[sowFile.type] = processedData as NeonPoleData[] & NeonDropData[] & NeonFibreData[];
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
