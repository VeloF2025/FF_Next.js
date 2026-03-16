/**
 * ContractorImport - Comprehensive contractor import component
 * Supports CSV and Excel file imports with validation and preview
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { ContractorFileDropZone } from './import/ContractorFileDropZone';
import { ContractorFilePreview } from './import/ContractorFilePreview';
import { ContractorImportResults } from './import/ContractorImportResults';
import { ContractorImportInstructions } from './import/ContractorImportInstructions';

export interface ContractorImportData {
  contractors: any[];
}

export interface ContractorImportOptions {
  mode: 'skipDuplicates' | 'updateExisting';
  sheetIndex?: number;
  hasHeaders?: boolean;
}

export interface ContractorImportResult {
  successCount: number;
  totalProcessed: number;
  errors: any[];
}

// Placeholder service - replace with actual implementation if needed
const contractorImportService = {
  parseFile: async (_file: File) => ({ contractors: [] } as ContractorImportData),
  processFile: async (_file: File, _options?: ContractorImportOptions) => ({ contractors: [] } as ContractorImportData),
  importContractors: async (_data: ContractorImportData, _options: ContractorImportOptions) => ({ successCount: 0, totalProcessed: 0, errors: [] } as ContractorImportResult),
  downloadTemplate: async () => new Blob(),
};

interface ContractorImportProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: (result: ContractorImportResult) => void;
  className?: string;
}

export function ContractorImport({
  isOpen,
  onClose,
  onComplete,
  className = ''
}: ContractorImportProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'results'>('upload');
  const [, setFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<ContractorImportData | null>(null);
  const [importOptions, setImportOptions] = useState<ContractorImportOptions>({
    mode: 'skipDuplicates',
    sheetIndex: 0,
    hasHeaders: true
  });
  const [importResult, setImportResult] = useState<ContractorImportResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setIsProcessing(true);

    try {
      const data = await contractorImportService.processFile(selectedFile, importOptions);
      setImportData(data);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!importData) return;

    setStep('importing');
    setIsProcessing(true);

    try {
      const result = await contractorImportService.importContractors(importData, importOptions);
      setImportResult(result);
      setStep('results');
      
      if (onComplete) {
        onComplete(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setImportData(null);
    setImportResult(null);
    setError(null);
    setIsProcessing(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Import Contractors" className="fixed inset-0 z-50 overflow-y-auto">
