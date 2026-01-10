/**
 * File Upload Area Component
 * Drag and drop file upload interface
 */

import { Upload, FileText, Table, X } from 'lucide-react';
import { formatFileSize } from '../utils/importUtils';

interface FileUploadAreaProps {
  selectedFile: File | null;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearFile: () => void;
}

export function FileUploadArea({ selectedFile, onFileSelect, onClearFile }: FileUploadAreaProps) {
  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith('.csv')) return <FileText className="w-5 h-5 text-green-400" />;
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) return <Table className="w-5 h-5 text-blue-400" />;
    return <FileText className="w-5 h-5 text-[var(--ff-text-tertiary)]" />;
  };

  return (
    <div className="border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-6 text-center hover:border-blue-500/50 transition-colors">
      {!selectedFile ? (
        <label className="cursor-pointer">
          <Upload className="w-12 h-12 text-[var(--ff-text-secondary)] mx-auto mb-4" />
          <p className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">Choose a file to upload</p>
          <p className="text-sm text-[var(--ff-text-secondary)] mb-4">CSV, Excel (.xlsx, .xls) files supported</p>
          <div className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Upload className="w-4 h-4 mr-2" />
            Select File
          </div>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onFileSelect}
            className="hidden"
          />
        </label>
      ) : (
        <div className="flex items-center justify-between p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
          <div className="flex items-center space-x-3">
            {getFileIcon(selectedFile.name)}
            <div className="text-left">
              <p className="font-medium text-[var(--ff-text-primary)]">{selectedFile.name}</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
          </div>
          <button
            onClick={onClearFile}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}