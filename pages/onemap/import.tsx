import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X, CheckCircle, AlertCircle } from 'lucide-react';
import { AppLayout } from '../../src/components/layout/AppLayout';

export default function OneMapImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check if it's an Excel or CSV file
      const validTypes = [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ];
      
      if (validTypes.includes(file.type) || file.name.match(/\.(xlsx|xls|csv)$/)) {
        setSelectedFile(file);
        setUploadStatus('idle');
        setUploadMessage('');
      } else {
        setUploadStatus('error');
        setUploadMessage('Please select a valid Excel or CSV file');
        setSelectedFile(null);
      }
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const validTypes = [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ];
      
      if (validTypes.includes(file.type) || file.name.match(/\.(xlsx|xls|csv)$/)) {
        setSelectedFile(file);
        setUploadStatus('idle');
        setUploadMessage('');
      } else {
        setUploadStatus('error');
        setUploadMessage('Please select a valid Excel or CSV file');
        setSelectedFile(null);
      }
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadStatus('idle');
    
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/onemap/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus('success');
        setUploadMessage(`Successfully imported ${result.recordsImported || 0} records from 1Map data`);
        // Clear file after successful upload
        setTimeout(() => {
          setSelectedFile(null);
          setUploadStatus('idle');
          setUploadMessage('');
        }, 5000);
      } else {
        setUploadStatus('error');
        setUploadMessage(result.error || 'Failed to import file');
      }
    } catch (error) {
      setUploadStatus('error');
      setUploadMessage('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / 1048576 * 10) / 10 + ' MB';
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Import Geographic Data from 1Map</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Upload Excel files exported from 1Map application to import geographic data</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
          {/* File Upload Area */}
          {!selectedFile ? (
            <div
              className="border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-12 text-center hover:border-[var(--ff-border-medium)] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <Upload className="mx-auto h-12 w-12 text-[var(--ff-text-tertiary)] mb-4" />
              <p className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
                Click to browse or drag and drop
              </p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mb-4">
                Select Excel file (.xlsx, .xls) or CSV file from 1Map export
              </p>
              <button
                type="button"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected File Display */}
              <div className="border border-[var(--ff-border-light)] rounded-lg p-4 bg-[var(--ff-bg-tertiary)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FileSpreadsheet className="h-10 w-10 text-green-500" />
                    <div>
                      <p className="font-medium text-[var(--ff-text-primary)]">{selectedFile.name}</p>
                      <p className="text-sm text-[var(--ff-text-tertiary)]">
                        {formatFileSize(selectedFile.size)} • Ready to import
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setUploadStatus('idle');
                      setUploadMessage('');
                    }}
                    className="p-1 hover:bg-[var(--ff-bg-hover)] rounded"
                  >
                    <X className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                  </button>
                </div>
              </div>

              {/* Upload Status Messages */}
              {uploadStatus === 'success' && (
                <div className="flex items-center p-4 bg-green-500/20 border border-green-500/50 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-400 mr-3" />
                  <p className="text-green-400">{uploadMessage}</p>
                </div>
              )}

              {uploadStatus === 'error' && (
                <div className="flex items-center p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-red-400 mr-3" />
                  <p className="text-red-400">{uploadMessage}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className={`px-6 py-2 rounded-lg font-medium ${
                    uploading
                      ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {uploading ? 'Processing...' : 'Import to Database'}
                </button>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setUploadStatus('idle');
                    setUploadMessage('');
                    fileInputRef.current?.click();
                  }}
                  disabled={uploading}
                  className="px-6 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] border border-[var(--ff-border-light)]"
                >
                  Choose Different File
                </button>
              </div>
            </div>
          )}

          {/* Information Panel */}
          <div className="mt-8 p-4 bg-blue-500/20 rounded-lg">
            <h3 className="font-medium text-blue-400 mb-2">Expected Data Format from 1Map</h3>
            <ul className="text-sm text-blue-300 space-y-1">
              <li>• Pole locations with GPS coordinates (latitude, longitude)</li>
              <li>• Fiber cable routes with start and end points</li>
              <li>• Splice points and junction boxes</li>
              <li>• Drop locations for customer connections</li>
              <li>• Associated metadata (IDs, descriptions, status)</li>
            </ul>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};