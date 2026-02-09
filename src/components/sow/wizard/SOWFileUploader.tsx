/**
 * SOW File Upload Component
 */

import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, Loader2 } from 'lucide-react';
import { SOWUploadStep } from './SOWWizardTypes';

interface SOWFileUploaderProps {
  currentStepData: SOWUploadStep;
  isUploading: boolean;
  uploadError: string | null;
  uploadProgress: string | null;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function SOWFileUploader({
  currentStepData,
  isUploading,
  uploadError,
  uploadProgress,
  onFileUpload
}: SOWFileUploaderProps) {
  const isCurrentStepComplete = currentStepData.completed;

  return (
    <div className="p-6">
      <div className="text-center mb-8">
        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${
          isCurrentStepComplete ? 'bg-green-500/20' : 'bg-blue-500/20'
        }`}>
          {isCurrentStepComplete ? (
            <CheckCircle className="w-8 h-8 text-green-400" />
          ) : (
            <FileSpreadsheet className="w-8 h-8 text-blue-400" />
          )}
        </div>
        <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
          {currentStepData.title}
        </h3>
        <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto">
          {currentStepData.description}
        </p>
      </div>

      {/* Upload Area */}
      {!isCurrentStepComplete && (
        <div className="max-w-md mx-auto">
          <div className="border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFileUpload}
              disabled={isUploading}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className={`cursor-pointer ${isUploading ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {isUploading ? (
                <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-spin" />
              ) : (
                <Upload className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              )}
              <p className="text-[var(--ff-text-secondary)]">
                {isUploading ? 'Processing file...' : 'Click to upload Excel file'}
              </p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-2">
                {uploadProgress ? uploadProgress : 'Supports .xlsx, .xls, and .csv files'}
              </p>
            </label>
          </div>

          {uploadError && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start">
              <AlertCircle className="w-5 h-5 text-red-400 mr-2 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-red-400 font-medium">Upload Error</p>
                <p className="text-red-400 text-sm mt-1">{uploadError}</p>
              </div>
            </div>
          )}

          {uploadProgress && !uploadError && (
            <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-center">
                <Loader2 className="w-5 h-5 text-blue-400 mr-2 animate-spin" />
                <div>
                  <p className="text-blue-400 font-medium">Processing</p>
                  <p className="text-blue-400 text-sm mt-1">{uploadProgress}</p>
                  <p className="text-blue-400/70 text-xs mt-2">This may take a few minutes for large datasets...</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success State */}
      {isCurrentStepComplete && currentStepData.file && (
        <div className="max-w-md mx-auto">
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
            <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
            <p className="text-green-400 font-medium">File uploaded successfully!</p>
            <p className="text-green-400 text-sm mt-1">
              {currentStepData.file.name}
            </p>
            <p className="text-green-400 text-sm">
              {currentStepData.data?.length || 0} records processed
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
