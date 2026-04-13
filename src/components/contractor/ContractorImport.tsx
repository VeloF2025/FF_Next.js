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

export interface ContractorRecord {
  isValid: boolean;
  isDuplicate: boolean;
  companyName: string;
  contactPerson?: string;
  email?: string;
  errors?: string[];
  warnings?: string[];
}

export interface ContractorImportData {
  contractors: ContractorRecord[];
}

export interface ContractorImportOptions {
  mode: 'skipDuplicates' | 'updateExisting';
  sheetIndex?: number;
  hasHeaders?: boolean;
}

export interface ContractorImportError {
  row: number;
  message: string;
}

export interface ContractorImportResult {
  successCount: number;
  totalProcessed: number;
  errors: ContractorImportError[];
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
  className: _className = ''
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
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-xl font-semibold">Import Contractors</h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {step === 'upload' && (
              <ContractorFileDropZone
                onFileSelect={handleFileSelect}
                isProcessing={isProcessing}
                error={error}
              />
            )}

            {step === 'preview' && importData && (
              <ContractorFilePreview
                data={importData}
                options={importOptions}
                onOptionsChange={setImportOptions}
                onImport={handleImport}
                isProcessing={isProcessing}
                error={error}
              />
            )}

            {step === 'importing' && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
                  <p className="text-gray-600">Processing import...</p>
                </div>
              </div>
            )}

            {step === 'results' && importResult && (
              <ContractorImportResults
                result={importResult}
                onReset={handleReset}
              />
            )}
          </div>

          {/* Footer */}
          {step === 'upload' && (
            <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-between items-center text-sm text-gray-600">
              <ContractorImportInstructions />
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
