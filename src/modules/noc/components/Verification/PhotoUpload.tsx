/**
 * PhotoUpload Component - Photo evidence upload for verification steps
 *
 * 🟢 WORKING: Production-ready photo upload component with preview
 *
 * Features:
 * - Drag & drop file upload
 * - Image preview with thumbnail
 * - File size and type validation
 * - Upload progress indicator
 * - Delete uploaded photo
 * - Accessible file input
 */

'use client';

import React, { useCallback, useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, CheckCircle, AlertCircle, Maximize2 } from 'lucide-react';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { cn } from '@/lib/utils';

interface PhotoUploadProps {
  /** Current photo URL if already uploaded */
  photoUrl?: string | null;
  /** Whether photo has been verified */
  photoVerified?: boolean;
  /** Whether upload is disabled */
  disabled?: boolean;
  /** Callback when photo is uploaded */
  onPhotoUploaded?: (photoUrl: string) => void;
  /** Callback when photo is deleted */
  onPhotoDeleted?: () => void;
  /** Maximum file size in MB */
  maxSizeMB?: number;
  /** Accepted file types */
  accept?: string;
  /** Compact mode for smaller display */
  compact?: boolean;
}

const MAX_FILE_SIZE_MB = 5;
const ACCEPTED_FILE_TYPES = 'image/jpeg,image/jpg,image/png,image/webp';

/**
 * 🟢 WORKING: Photo upload component for verification steps
 */
export function PhotoUpload({
  photoUrl,
  photoVerified = false,
  disabled = false,
  onPhotoUploaded,
  onPhotoDeleted,
  maxSizeMB = MAX_FILE_SIZE_MB,
  accept = ACCEPTED_FILE_TYPES,
  compact = false,
}: PhotoUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showLightbox, setShowLightbox] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🟢 WORKING: Validate file before upload
  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file type
      const acceptedTypes = accept.split(',').map(t => t.trim());
      if (!acceptedTypes.includes(file.type)) {
        return `Invalid file type. Accepted: ${accept}`;
      }

      // Check file size
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        return `File too large. Maximum size: ${maxSizeMB}MB`;
      }

      return null;
    },
    [accept, maxSizeMB]
  );

  // 🟢 WORKING: Handle file upload
  const handleFileUpload = useCallback(
    async (file: File) => {
      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      setIsUploading(true);
      setUploadProgress(0);

      try {
        // Upload to unified storage API
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'maintenance');
        formData.append('category', 'verification-photos');

        // Start progress indicator
        const progressInterval = setInterval(() => {
          setUploadProgress(prev => {
            if (prev >= 90) {
              clearInterval(progressInterval);
              return 90;
            }
            return prev + 10;
          });
        }, 100);

        const response = await fetch('/api/storage/upload', {
          method: 'POST',
          body: formData,
        });

        clearInterval(progressInterval);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Upload failed: ${response.status}`);
        }

        const result = await response.json();
        setUploadProgress(100);

        // Notify parent component with the storage URL
        if (onPhotoUploaded) {
          onPhotoUploaded(result.url);
        }

        setIsUploading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        setIsUploading(false);
      }
    },
    [validateFile, onPhotoUploaded]
  );

  // 🟢 WORKING: Handle file input change
  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  // 🟢 WORKING: Handle drag & drop
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);

      const file = event.dataTransfer.files[0];
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  // 🟢 WORKING: Handle click to open file picker
  const handleClick = useCallback(() => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  }, [disabled, isUploading]);

  // 🟢 WORKING: Handle delete photo
  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (onPhotoDeleted) {
        onPhotoDeleted();
      }
    },
    [onPhotoDeleted]
  );

  // Render uploaded photo preview with lightbox
  if (photoUrl) {
    return (
      <>
        <div className={cn('relative group', compact ? 'w-16 h-16' : 'w-32 h-32')}>
          <img
            src={photoUrl}
            alt="Photo for step"
            className="w-full h-full object-cover rounded-lg border border-[var(--ff-border-light)] cursor-pointer transition-opacity hover:opacity-90"
            onClick={() => setShowLightbox(true)}
          />

          {/* Enlarge overlay on hover */}
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            onClick={() => setShowLightbox(true)}
          >
            <Maximize2 className="w-5 h-5 text-white" />
          </div>

          {/* Verified badge */}
          {photoVerified && (
            <div className="absolute -top-1 -right-1 bg-green-500 rounded-full p-1">
              <CheckCircle className="w-3 h-3 text-[var(--ff-text-primary)]" />
            </div>
          )}

          {/* Delete button */}
          {!disabled && (
            <button
              onClick={handleDelete}
              className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 rounded-full p-1 transition-colors z-10"
              title="Delete photo"
            >
              <X className="w-3 h-3 text-[var(--ff-text-primary)]" />
            </button>
          )}
        </div>

        {/* Lightbox modal */}
        {showLightbox && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowLightbox(false)}
          >
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>
            <img
              src={photoUrl}
              alt="Photo for step (enlarged)"
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </>
    );
  }

  // 🟢 WORKING: Render upload area
  return (
    <div className="w-full">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileInputChange}
        disabled={disabled || isUploading}
        className="hidden"
        aria-label="Upload photo"
      />

      {/* Upload area */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'border-2 border-dashed rounded-lg transition-all cursor-pointer',
          compact ? 'p-2' : 'p-4',
          isDragging
            ? 'border-blue-400 bg-blue-400/10'
            : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-light)]',
          disabled || isUploading ? 'opacity-50 cursor-not-allowed' : '',
          error ? 'border-red-400' : ''
        )}
      >
        {isUploading ? (
          // Upload progress
          <div className="flex flex-col items-center justify-center space-y-2">
            <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-xs text-[var(--ff-text-secondary)]">Uploading... {uploadProgress}%</p>
          </div>
        ) : (
          // Upload prompt
          <div className={cn('flex items-center justify-center', compact ? 'space-x-1' : 'space-x-2')}>
            {compact ? (
              <>
                <Upload className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                <span className="text-xs text-[var(--ff-text-primary)]">Upload Photo</span>
              </>
            ) : (
              <VelocityButton
                variant="glass"
                size="sm"
                disabled={disabled}
                className="pointer-events-none"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Photo
              </VelocityButton>
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-2 flex items-center space-x-1 text-red-400 text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
