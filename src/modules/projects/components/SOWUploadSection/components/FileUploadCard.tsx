import React from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Download,
  Trash2
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { SOWFile, FileTypeConfig } from '../types/sowUpload.types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface FileUploadCardProps {
  fileType: FileTypeConfig;
  uploadedFile?: SOWFile;
  isProcessing: boolean;
  onFileUpload: (type: 'poles' | 'drops' | 'fibre', event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (type: string) => void;
  onDownloadTemplate: () => void;
}

export function FileUploadCard({
  fileType,
  uploadedFile,
  isProcessing,
  onFileUpload,
  onRemoveFile,
  onDownloadTemplate
}: FileUploadCardProps) {
  const Icon = fileType.icon;

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-dashed p-6 transition-colors",
        uploadedFile?.status === 'success'
          ? `${fileType.bgColor} ${fileType.borderColor}`
          : uploadedFile?.status === 'error'
          ? "bg-error-50 border-error-200"
          : "border-[var(--ff-border-secondary)] hover:border-[var(--ff-border-primary)]"
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("p-2 rounded-lg", fileType.bgColor)}>
          <Icon className={cn("w-6 h-6", fileType.color)} />
        </div>

        {uploadedFile && (
          <button
            onClick={() => onRemoveFile(fileType.type)}
            className="p-1 hover:bg-[var(--ff-surface-secondary)] rounded"
          >
            <Trash2 className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          </button>
        )}
      </div>

      <h3 className="font-medium text-[var(--ff-text-primary)] mb-1">
        {fileType.title}
      </h3>
      <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
        {fileType.description}
      </p>

      {uploadedFile ? (
        <FileUploadStatus
          uploadedFile={uploadedFile}
        />
      ) : (
        <FileUploadActions
          fileType={fileType}
          isProcessing={isProcessing}
          onFileUpload={onFileUpload}
          onDownloadTemplate={onDownloadTemplate}
        />
      )}
    </div>
  );
}

function FileUploadStatus({ uploadedFile }: { uploadedFile: SOWFile }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        <span className="text-sm text-[var(--ff-text-primary)] truncate">
          {uploadedFile.file.name}
        </span>
      </div>

      {uploadedFile.status === 'processing' && (
        <div className="flex items-center gap-2">
          <InlineSpinner size="sm" className="text-primary-500" />
          <span className="text-sm text-[var(--ff-text-secondary)]">Processing...</span>
        </div>
      )}

      {uploadedFile.status === 'success' && uploadedFile.summary && (
        <div className="bg-success-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-success-600" />
            <span className="text-sm font-medium text-success-900">
              Successfully processed
            </span>
          </div>
          <div className="text-xs text-success-700 space-y-1">
            <p>Total rows: {uploadedFile.summary.total}</p>
            <p>Valid: {uploadedFile.summary.valid}</p>
            {uploadedFile.summary.invalid > 0 && (
              <p>Skipped: {uploadedFile.summary.invalid}</p>
            )}
          </div>
          {uploadedFile.summary.warnings && uploadedFile.summary.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-warning-600 cursor-pointer">
                {uploadedFile.summary.warnings.length} warnings
              </summary>
              <div className="mt-1 text-xs text-warning-600 max-h-20 overflow-y-auto">
                {uploadedFile.summary.warnings.slice(0, 5).map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
                {uploadedFile.summary.warnings.length > 5 && (
                  <p>... and {uploadedFile.summary.warnings.length - 5} more</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {uploadedFile.status === 'error' && (
        <div className="bg-error-50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-error-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-error-900">Upload failed</p>
              <p className="text-xs text-error-700 mt-1">
                {uploadedFile.message}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FileUploadActions({
  fileType,
  isProcessing,
  onFileUpload,
  onDownloadTemplate
}: {
  fileType: FileTypeConfig;
  isProcessing: boolean;
  onFileUpload: (type: 'poles' | 'drops' | 'fibre', event: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => onFileUpload(fileType.type, e)}
          className="hidden"
          disabled={isProcessing}
        />
        <div className={cn(
          "flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
          isProcessing
            ? "bg-[var(--ff-surface-secondary)] text-[var(--ff-text-tertiary)] cursor-not-allowed"
            : "bg-primary-600 text-white hover:bg-primary-700"
        )}>
          <Upload className="w-4 h-4" />
          Upload File
        </div>
      </label>

      <button
        onClick={onDownloadTemplate}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
      >
        <Download className="w-4 h-4" />
        Download Template
      </button>
    </div>
  );
}