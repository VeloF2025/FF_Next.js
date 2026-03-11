/**
 * ContractorFileDropZone - Drag and drop file upload component
 */

import React, { useCallback, useState } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';

interface ContractorFileDropZoneProps {
  onFileSelect: (file: File) => void;
  isProcessing?: boolean;
  className?: string;
}

export function ContractorFileDropZone({
  onFileSelect,
  isProcessing = false,
  className = ''
}: ContractorFileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);

  const validateFile = (file: File): string | null => {
    // Check file type
    const validTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.csv',
      '.xlsx',
      '.xls'
    ];
    
    const isValidType = validTypes.some(type => 
      file.type === type || file.name.toLowerCase().endsWith(type.replace('application/vnd.', ''))
    );
    
    if (!isValidType) {
      return 'Please select a CSV or Excel file (.csv, .xlsx, .xls)';
    }

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      return 'File size must be less than 50MB';
    }

    return null;
  };

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
    setDragError(null);
  }, [isDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
    setDragError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    if (!file) return;
    const error = validateFile(file);
    
    if (error) {
      setDragError(error);
      return;
    }

    setDragError(null);
    onFileSelect(file);
  }, [onFileSelect]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file) return;
    const error = validateFile(file);
    
    if (error) {
      setDragError(error);
      return;
    }

    setDragError(null);
    onFileSelect(file);
  };

  return (
    <div className={className}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-lg p-6 text-center transition-colors
          ${isDragOver ? 'border-blue-400 bg-blue-50' : 'border-border'}
          ${isProcessing ? 'pointer-events-none opacity-50' : 'hover:border-gray-400 hover:bg-background'}
          ${dragError ? 'border-red-300 bg-red-50' : ''}
        `}
      >
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileSelect}
          disabled={isProcessing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />

        <div className="flex flex-col items-center justify-center space-y-4">
          {isProcessing ? (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="text-sm text-muted-foreground">Processing file...</p>
            </>
          ) : dragError ? (
            <>
              <AlertCircle className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-800">Upload Error</p>
                <p className="text-sm text-red-600">{dragError}</p>
              </div>
              <p className="text-xs text-muted-foreground">Try again with a valid file</p>
            </>
          ) : (
            <>
              {isDragOver ? (
                <FileText className="w-8 h-8 text-blue-500" />
              ) : (
                <Upload className="w-8 h-8 text-gray-400" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isDragOver ? 'Drop file here' : 'Drop files here or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  CSV, Excel (.xlsx, .xls) files up to 50MB
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Supported formats info */}
      <div className="mt-3 text-xs text-muted-foreground">
        <p className="font-medium">Supported formats:</p>
        <ul className="mt-1 space-y-1">
          <li>• CSV files (.csv)</li>
          <li>• Excel files (.xlsx, .xls)</li>
          <li>• Maximum file size: 50MB</li>
        </ul>
      </div>
    </div>
  );
}