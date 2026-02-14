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
import { contractorImportService } from '@/services/contractor/import';
import type { 
  ContractorImportData, 
  ContractorImportOptions, 
  ContractorImportResult 
} from '@/types/contractor/import.types';

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
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className={`
          inline-block align-bottom bg-card rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full sm:p-6
          ${className}
        `}>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Import Contractors
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Upload CSV or Excel files to bulk import contractor data
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-muted-foreground transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Import Error</h3>
                  <div className="mt-2 text-sm text-red-700">{error}</div>
                </div>
              </div>
            </div>
          )}

          {/* Step Content */}
          {step === 'upload' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <ContractorFileDropZone
                  onFileSelect={handleFileSelect}
                  isProcessing={isProcessing}
                  className="h-64"
                />
                <div className="mt-4">
                  <button
                    onClick={() => contractorImportService.downloadTemplate()}
                    className="text-sm text-blue-600 hover:text-blue-500"
                  >
                    Download CSV Template
                  </button>
                </div>
              </div>
              <div>
                <ContractorImportInstructions />
              </div>
            </div>
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
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-lg font-medium text-foreground">Importing contractors...</p>
              <p className="text-sm text-muted-foreground">This may take a few moments</p>
            </div>
          )}

          {step === 'results' && importResult && (
            <ContractorImportResults
              result={importResult}
              onClose={handleClose}
              onImportMore={handleReset}
            />
          )}

          {/* Footer */}
          {step === 'upload' && (
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-muted-foreground bg-card border border-border rounded-md hover:bg-background transition-colors"
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

export default ContractorImport;