'use client';

/**
 * Document Upload Form - Client Component
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, File, X, Loader2 } from 'lucide-react';
import { DocumentType, DOCUMENT_TYPE_CONFIG } from '@/modules/assets/types/document';
import { toast } from 'react-hot-toast';

interface DocumentUploadFormProps {
  assetId: string;
}

export function DocumentUploadForm({ assetId }: DocumentUploadFormProps) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [formData, setFormData] = useState({
    documentType: DocumentType.PURCHASE_INVOICE,
    documentName: '',
    documentNumber: '',
    issueDate: '',
    expiryDate: '',
    issuingAuthority: '',
    notes: '',
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Auto-fill document name if empty
      if (!formData.documentName) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        setFormData(prev => ({ ...prev, documentName: nameWithoutExt }));
      }
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploadProgress(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile) {
      toast.error('Please select a file to upload');
      return;
    }

    if (!formData.documentName.trim()) {
      toast.error('Please enter a document name');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Upload file to VF Storage
      // Use simple category (not nested with assetId) - include assetId in filename prefix
      const uploadFormData = new FormData();
      const prefixedFileName = `${assetId}_${selectedFile.name}`;
      uploadFormData.append('file', new File([selectedFile], prefixedFileName, { type: selectedFile.type }));
      uploadFormData.append('type', 'assets');
      uploadFormData.append('category', 'documents');

      setUploadProgress(30); // Show some progress during upload

      const uploadResponse = await fetch('/api/storage/upload', {
        method: 'POST',
        body: uploadFormData,
      });

      setUploadProgress(70);

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.json();
        throw new Error(uploadError.error || 'Failed to upload file');
      }

      const uploadResult = await uploadResponse.json();
      const fileUrl = uploadResult.url;
      const filePath = uploadResult.path;

      setUploadProgress(90);

      // Save document metadata to API
      const response = await fetch(`/api/assets/${assetId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          fileName: selectedFile.name,
          filePath,
          fileUrl,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save document');
      }

      setUploadProgress(100);
      toast.success('Document uploaded successfully');
      router.push(`/assets/${assetId}`);
      router.refresh();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload document');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File Upload Area */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          File *
        </label>

        {!selectedFile ? (
          <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-purple-500 dark:hover:border-purple-400 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="h-10 w-10 text-gray-400 mb-3" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium text-purple-600 dark:text-purple-400">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                PDF, DOC, XLS, images up to 10MB
              </p>
            </div>
            <input
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            />
          </label>
        ) : (
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center space-x-3">
              <File className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveFile}
              className="p-1 text-gray-400 hover:text-red-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {uploadProgress > 0 && uploadProgress < 100 && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
              <span>Uploading...</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
              <div
                className="bg-purple-600 h-2 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Document Details */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Document Details</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Document Type *
            </label>
            <select
              value={formData.documentType}
              onChange={(e) => setFormData(prev => ({ ...prev, documentType: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white"
            >
              {Object.entries(DOCUMENT_TYPE_CONFIG).map(([value, config]) => (
                <option key={value} value={value}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Document Name *
            </label>
            <input
              type="text"
              value={formData.documentName}
              onChange={(e) => setFormData(prev => ({ ...prev, documentName: e.target.value }))}
              placeholder="e.g., Invoice #12345"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Document Number
            </label>
            <input
              type="text"
              value={formData.documentNumber}
              onChange={(e) => setFormData(prev => ({ ...prev, documentNumber: e.target.value }))}
              placeholder="e.g., INV-2024-001"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Issuing Authority
            </label>
            <input
              type="text"
              value={formData.issuingAuthority}
              onChange={(e) => setFormData(prev => ({ ...prev, issuingAuthority: e.target.value }))}
              placeholder="e.g., EXFO, Calibration Lab"
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Issue Date
            </label>
            <input
              type="date"
              value={formData.issueDate}
              onChange={(e) => setFormData(prev => ({ ...prev, issueDate: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Expiry Date
            </label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData(prev => ({ ...prev, expiryDate: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            rows={3}
            placeholder="Additional notes about this document..."
            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isUploading || !selectedFile}
          className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </>
          )}
        </button>
      </div>
    </form>
  );
}
