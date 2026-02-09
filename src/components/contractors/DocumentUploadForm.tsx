'use client';

/**
 * Document Upload Form
 * Modal form for uploading contractor documents
 */

import { useState } from 'react';
import { X, Upload, FileText, AlertCircle } from 'lucide-react';
import { DocumentType, DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES } from '@/types/contractor-document.types';
import { log } from '@/lib/logger';

interface DocumentUploadFormProps {
  contractorId: string;
  onSuccess: () => void;
  onCancel: () => void;
  defaultDocumentType?: DocumentType;
}

export function DocumentUploadForm({ contractorId, onSuccess, onCancel, defaultDocumentType }: DocumentUploadFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    documentType: defaultDocumentType || ('insurance_liability' as DocumentType),
    documentName: '',
    documentNumber: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type - Allow PDF, images, Word, and Excel
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',                                                      // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel',                                                // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',      // .xlsx
    ];
    if (!allowedTypes.includes(selectedFile.type)) {
      setError('Invalid file type. Please upload PDF, JPG, PNG, Word (DOC/DOCX), or Excel (XLS/XLSX) files only.');
      setFile(null);
      return;
    }

    // Validate file size (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setError('File too large. Maximum size is 10MB.');
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setError(null);
    setUploadProgress(0);

    // Generate preview for images
    if (selectedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreview(e.target?.result as string);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      setFilePreview(null);
    }

    // Auto-populate document name from filename if empty
    if (!formData.documentName) {
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '');
      setFormData(prev => ({ ...prev, documentName: nameWithoutExt }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError('Please select a file to upload');
      return;
    }

    if (!formData.documentName) {
      setError('Please enter a document name');
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    // Create FormData for file upload
    const uploadData = new FormData();
    uploadData.append('contractorId', contractorId);
    uploadData.append('documentType', formData.documentType);
    uploadData.append('documentName', formData.documentName);
    uploadData.append('documentNumber', formData.documentNumber);
    uploadData.append('issueDate', formData.issueDate);
    uploadData.append('expiryDate', formData.expiryDate);
    uploadData.append('notes', formData.notes);
    uploadData.append('uploadedBy', 'current-user@fibreflow.com'); // TODO: Get from auth
    uploadData.append('file', file);

    // Use XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();

    return new Promise<void>((resolve, reject) => {
      // Progress tracking
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percentComplete);
        }
      });

      // Success handler
      xhr.addEventListener('load', () => {
        setIsSubmitting(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadProgress(100);
          onSuccess();
          resolve();
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            setError(errorData.error || 'Failed to upload document');
          } catch {
            setError(`Upload failed with status ${xhr.status}`);
          }
          setUploadProgress(0);
          reject(new Error('Upload failed'));
        }
      });

      // Error handler
      xhr.addEventListener('error', () => {
        setIsSubmitting(false);
        setUploadProgress(0);
        setError('Network error occurred during upload');
        reject(new Error('Network error'));
      });

      // Timeout handler (30 seconds)
      xhr.addEventListener('timeout', () => {
        setIsSubmitting(false);
        setUploadProgress(0);
        setError('Upload timed out. Please try again.');
        reject(new Error('Timeout'));
      });

      // Configure and send request
      xhr.open('POST', '/api/contractors-documents-upload');
      xhr.timeout = 30000; // 30 second timeout
      xhr.send(uploadData);
    }).catch((err) => {
      log.error('Document upload error', { error: err, contractorId }, 'DocumentUploadForm');
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Upload Document</h2>
          <button
            onClick={onCancel}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
            disabled={isSubmitting}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Error Banner */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Upload Failed</p>
                <p className="text-sm text-red-400 mt-1">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              File * <span className="text-[var(--ff-text-tertiary)] font-normal">(PDF, JPG, PNG, Word, Excel - Max 10MB)</span>
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
                disabled={isSubmitting}
              />
              <label
                htmlFor="file-upload"
                className={`flex items-center justify-center gap-3 px-4 py-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                  file
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] hover:border-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-hover)]'
                } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {file ? (
                  <>
                    <FileText className="h-8 w-8 text-blue-400" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-[var(--ff-text-primary)]">{file.name}</p>
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-[var(--ff-text-tertiary)]" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-[var(--ff-text-secondary)]">Click to upload</p>
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">or drag and drop</p>
                    </div>
                  </>
                )}
              </label>
            </div>

            {/* Image Preview */}
            {filePreview && (
              <div className="mt-4">
                <img
                  src={filePreview}
                  alt="Preview"
                  className="max-h-48 rounded-lg border border-[var(--ff-border-light)] mx-auto"
                />
              </div>
            )}

            {/* Upload Progress */}
            {isSubmitting && uploadProgress > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-[var(--ff-text-secondary)] mb-2">
                  <span>Uploading...</span>
                  <span className="font-medium">{uploadProgress}%</span>
                </div>
                <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Document Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Document Type *
            </label>
            <select
              value={formData.documentType}
              onChange={(e) => setFormData({ ...formData, documentType: e.target.value as DocumentType })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              disabled={isSubmitting}
            >
              {Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([category, types]) => (
                <optgroup key={category} label={category}>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Document Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Document Name *
            </label>
            <input
              type="text"
              value={formData.documentName}
              onChange={(e) => setFormData({ ...formData, documentName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-[var(--ff-text-tertiary)]"
              placeholder="e.g., Annual Public Liability Insurance"
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Document Number */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Document/Policy Number
            </label>
            <input
              type="text"
              value={formData.documentNumber}
              onChange={(e) => setFormData({ ...formData, documentNumber: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-[var(--ff-text-tertiary)]"
              placeholder="e.g., POL-2025-001"
              disabled={isSubmitting}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Issue Date
              </label>
              <input
                type="date"
                value={formData.issueDate}
                onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Expiry Date
              </label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-[var(--ff-text-tertiary)]"
              placeholder="Any additional notes about this document..."
              disabled={isSubmitting}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file || isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload Document
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
