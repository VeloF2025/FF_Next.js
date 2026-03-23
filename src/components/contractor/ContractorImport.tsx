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
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} aria-hidden="true" />
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-2xl bg-white rounded-lg shadow-xl">
          {/* Header */}
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {step === 'upload' && 'Upload Contractor Data'}
              {step === 'preview' && 'Review Contractor Data'}
              {step === 'importing' && 'Importing Contractors'}
              {step === 'results' && 'Import Complete'}
            </h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            {step === 'upload' && (
              <ContractorFileDropZone
                onFileSelect={handleFileSelect}
                isProcessing={isProcessing}
              />
            )}
            {step === 'preview' && importData && (
              <ContractorFilePreview
                data={importData}
                options={importOptions}
                onOptionsChange={setImportOptions}
                onImport={handleImport}
                onCancel={handleReset}
                isProcessing={isProcessing}
              />
            )}
            {step === 'importing' && (
              <div className="py-12 text-center">
                <div className="inline-block">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
                </div>
                <p className="mt-4 text-gray-600">Importing contractors...</p>
              </div>
            )}
            {step === 'results' && importResult && (
              <ContractorImportResults
                result={importResult}
                onClose={handleClose}
                onImportMore={handleReset}
              />
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3 bg-gray-50">
            {step === 'upload' && (
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
            {step === 'results' && (
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
