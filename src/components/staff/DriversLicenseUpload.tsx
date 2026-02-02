/**
 * DriversLicenseUpload
 *
 * Specialized upload component for driver's license documents.
 * Requires both front and back sides to be uploaded.
 */

import React, { useCallback, useState } from 'react';
import { useDropzone, DropzoneState } from 'react-dropzone';
import {
  Upload,
  X,
  Check,
  AlertCircle,
  Image as ImageIcon,
} from 'lucide-react';
import {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  formatFileSize,
} from '@/types/staff-document.types';
import Image from 'next/image';

interface DriversLicenseFiles {
  front: File | null;
  back: File | null;
}

interface DriversLicenseUploadProps {
  files: DriversLicenseFiles;
  onFilesChange: (files: DriversLicenseFiles) => void;
  error?: string;
}

interface FilePreview {
  url: string;
  name: string;
  size: number;
}

export function DriversLicenseUpload({
  files,
  onFilesChange,
  error,
}: DriversLicenseUploadProps) {
  const [previews, setPreviews] = useState<{
    front: FilePreview | null;
    back: FilePreview | null;
  }>({
    front: null,
    back: null,
  });

  const handleFileSelect = useCallback(
    (side: 'front' | 'back', acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      // Validate file type
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return;
      }

      // Create preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviews((prev) => ({
            ...prev,
            [side]: {
              url: e.target?.result as string,
              name: file.name,
              size: file.size,
            },
          }));
        };
        reader.readAsDataURL(file);
      } else {
        setPreviews((prev) => ({
          ...prev,
          [side]: {
            url: '',
            name: file.name,
            size: file.size,
          },
        }));
      }

      // Update files
      onFilesChange({
        ...files,
        [side]: file,
      });
    },
    [files, onFilesChange]
  );

  const handleRemoveFile = useCallback(
    (side: 'front' | 'back') => {
      setPreviews((prev) => ({
        ...prev,
        [side]: null,
      }));
      onFilesChange({
        ...files,
        [side]: null,
      });
    },
    [files, onFilesChange]
  );

  // Call useDropzone at top level for both sides
  const frontDropzone = useDropzone({
    onDrop: (acceptedFiles) => handleFileSelect('front', acceptedFiles),
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png'],
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    disabled: !!files.front,
  });

  const backDropzone = useDropzone({
    onDrop: (acceptedFiles) => handleFileSelect('back', acceptedFiles),
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png'],
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    disabled: !!files.back,
  });

  const renderDropzone = (
    side: 'front' | 'back',
    label: string,
    dropzone: DropzoneState
  ) => {
    const file = files[side];
    const preview = previews[side];
    const hasFile = !!file;
    const { getRootProps, getInputProps, isDragActive } = dropzone;

    return (
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          {label}
        </label>

        {hasFile ? (
          // File preview
          <div className="relative rounded-lg border-2 border-green-500/50 bg-green-500/10 p-4">
            <div className="flex items-center gap-3">
              {preview?.url ? (
                <div className="relative w-24 h-16 rounded overflow-hidden bg-gray-800">
                  <Image
                    src={preview.url}
                    alt={`${label} preview`}
                    fill
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="w-24 h-16 rounded bg-gray-800 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-gray-600" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {preview?.name || file.name}
                </p>
                <p className="text-xs text-gray-400">
                  {formatFileSize(preview?.size || file.size)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveFile(side)}
                  className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                  title="Remove file"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          // Upload dropzone
          <div
            {...getRootProps()}
            className={`
              rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-all
              ${isDragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-600 hover:border-gray-500 bg-gray-800/50'
              }
            `}
          >
            <input {...getInputProps()} />
            <Upload className={`w-8 h-8 mx-auto mb-2 ${isDragActive ? 'text-blue-400' : 'text-gray-500'}`} />
            <p className="text-sm text-gray-400">
              {isDragActive ? 'Drop file here' : 'Click or drag to upload'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              JPG, PNG, or PDF (max 10MB)
            </p>
          </div>
        )}
      </div>
    );
  };

  const canProceed = files.front && files.back;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-blue-400 bg-blue-500/10 rounded-lg p-3">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>Please upload both the front and back of your driver&apos;s license</span>
      </div>

      <div className="flex gap-4">
        {renderDropzone('front', 'Front Side', frontDropzone)}
        {renderDropzone('back', 'Back Side', backDropzone)}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-4 pt-2">
        <div className={`flex items-center gap-2 text-sm ${files.front ? 'text-green-400' : 'text-gray-500'}`}>
          {files.front ? <Check className="w-4 h-4" /> : <div className="w-4 h-4 rounded-full border border-current" />}
          <span>Front uploaded</span>
        </div>
        <div className={`flex items-center gap-2 text-sm ${files.back ? 'text-green-400' : 'text-gray-500'}`}>
          {files.back ? <Check className="w-4 h-4" /> : <div className="w-4 h-4 rounded-full border border-current" />}
          <span>Back uploaded</span>
        </div>
      </div>

      {canProceed && (
        <div className="flex items-center justify-center gap-2 text-green-400 text-sm">
          <Check className="w-4 h-4" />
          <span>Both sides uploaded - ready to continue</span>
        </div>
      )}
    </div>
  );
}

export default DriversLicenseUpload;
