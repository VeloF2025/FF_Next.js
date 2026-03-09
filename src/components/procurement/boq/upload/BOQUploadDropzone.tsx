/**
 * BOQ Upload Dropzone Component
 */

import { useDropzone } from 'react-dropzone';
import { Upload, X, FileSpreadsheet } from 'lucide-react';

interface BOQUploadDropzoneProps {
  file: File | null;
  isUploading: boolean;
  onFileSelect: (file: File) => void;
  onFileRemove: () => void;
}

export function BOQUploadDropzone({
  file,
  isUploading,
  onFileSelect,
  onFileRemove
}: BOQUploadDropzoneProps) {
  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop: (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        if (file) {
          onFileSelect(file);
        }
      }
    },
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv']
    },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50MB
    disabled: isUploading
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div
      {...getRootProps()}
      className={`
        relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
        ${isDragActive ? 'border-blue-400 bg-blue-500/10' : 'border-[var(--ff-border-light)]'}
        ${isDragReject ? 'border-red-400 bg-red-500/10' : ''}
        ${isUploading ? 'pointer-events-none opacity-50' : 'hover:border-blue-400/50'}
      `}
    >
      <input {...getInputProps()} />

      {!file ? (
        <div className="space-y-4">
          <Upload className="mx-auto h-12 w-12 text-[var(--ff-text-secondary)]" />
          <div>
            <p className="text-lg font-medium text-[var(--ff-text-primary)]">
              {isDragActive ? 'Drop your BOQ file here' : 'Upload BOQ File'}
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Drag and drop your Excel (.xlsx, .xls) or CSV file here, or click to browse
            </p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-2">
              Maximum file size: 50MB
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-center space-x-3">
            <FileSpreadsheet className="h-8 w-8 text-green-500" />
            <div className="text-left">
              <p className="font-medium text-[var(--ff-text-primary)]">{file.name}</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">{formatFileSize(file.size)}</p>
            </div>
            {!isUploading && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFileRemove();
                }}
                className="p-1 rounded-full hover:bg-[var(--ff-bg-hover)]"
              >
                <X className="h-4 w-4 text-[var(--ff-text-secondary)]" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
