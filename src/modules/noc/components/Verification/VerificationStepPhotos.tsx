/**
 * VerificationStepPhotos — multi-photo gallery for a verification step.
 *
 * Renders every attachment where verification_step_id = step.id and
 * is_evidence = true, plus an "Add photo" tile for uploading more. Each
 * upload becomes a new `maintenance_attachments` row linked to the step;
 * the service layer keeps the step's legacy `photo_url` in sync with the
 * oldest attachment so existing readers (QA workflow, closeout reports)
 * keep working.
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Upload, X, Maximize2, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { verificationKeys } from '../../hooks/useVerification';
import type { VerificationStepPhoto } from '../../types/verification';

interface VerificationStepPhotosProps {
  /** Ticket UUID — needed to POST to /api/noc/tickets/[id]/attachments */
  ticketId: string;
  /** Verification step UUID — becomes the verification_step_id on each attachment */
  stepId: string;
  /** Existing photos for this step (usually from the parent query). */
  photos: VerificationStepPhoto[];
  /** When true, the step is marked "QA verified" — shows a badge on every photo. */
  photoVerified?: boolean;
  /** Upload/delete disabled when the ticket is read-only or the step is locked. */
  disabled?: boolean;
  /** Compact thumbnail size for dense layouts. */
  compact?: boolean;
}

const MAX_FILE_SIZE_MB = 5;
const ACCEPTED_TYPES = 'image/jpeg,image/jpg,image/png,image/webp';

function resolvePhotoUrl(photo: VerificationStepPhoto): string | null {
  return photo.storage_url || photo.file_url || null;
}

export function VerificationStepPhotos({
  ticketId,
  stepId,
  photos,
  photoVerified = false,
  disabled = false,
  compact = false,
}: VerificationStepPhotosProps) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: verificationKeys.steps(ticketId) });
    queryClient.invalidateQueries({ queryKey: verificationKeys.progress(ticketId) });
  }, [queryClient, ticketId]);

  // Upload one file at a time — browsers run these in parallel when the user
  // selects multiple files, so each becomes its own attachment row.
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!currentUser?.id) {
        throw new Error('Must be signed in to upload photos');
      }
      const form = new FormData();
      form.append('file', file);
      form.append('uploaded_by', currentUser.id);
      form.append('verification_step_id', stepId);
      form.append('is_evidence', 'true');

      const res = await fetch(`/api/noc/tickets/${ticketId}/attachments`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Upload failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (attachmentId: string) => {
      const res = await fetch(`/api/noc/attachments/${attachmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Delete failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Delete failed');
    },
  });

  const validateAndUpload = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
      const accepted = ACCEPTED_TYPES.split(',');
      for (const file of Array.from(files)) {
        if (!accepted.includes(file.type)) {
          setError(`Invalid file type: ${file.name}. Accepted: JPG, PNG, WebP`);
          continue;
        }
        if (file.size > maxBytes) {
          setError(`File too large: ${file.name} (max ${MAX_FILE_SIZE_MB}MB)`);
          continue;
        }
        uploadMutation.mutate(file);
      }
    },
    [uploadMutation]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) validateAndUpload(files);
      // Reset so picking the same file again re-triggers onChange
      event.target.value = '';
    },
    [validateAndUpload]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const files = event.dataTransfer.files;
      if (files.length > 0) validateAndUpload(files);
    },
    [disabled, validateAndUpload]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (disabled) return;
      const items = event.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length > 0) validateAndUpload(pasted);
    },
    [disabled, validateAndUpload]
  );

  const thumbSize = compact ? 'w-16 h-16' : 'w-24 h-24';
  const isBusy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        onChange={handleFileChange}
        disabled={disabled}
        className="hidden"
        aria-label="Upload photos"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={disabled}
        className="hidden"
        aria-label="Take photo"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
        onPaste={handlePaste}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          'flex flex-wrap gap-2 p-2 rounded-lg border-2 border-dashed transition-colors',
          isDragging ? 'border-blue-400 bg-blue-400/10' : 'border-[var(--ff-border-light)]',
          disabled && 'opacity-60'
        )}
      >
        {photos.map((photo) => {
          const url = resolvePhotoUrl(photo);
          if (!url) return null;
          return (
            <div key={photo.id} className={cn('relative group', thumbSize)}>
              <img
                src={url}
                alt={photo.filename || 'Verification photo'}
                className="w-full h-full object-cover rounded-lg border border-[var(--ff-border-light)] cursor-pointer transition-opacity hover:opacity-90"
                onClick={() => setLightboxUrl(url)}
              />
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => setLightboxUrl(url)}
              >
                <Maximize2 className="w-4 h-4 text-white" />
              </div>
              {photoVerified && (
                <div className="absolute -top-1 -right-1 bg-green-500 rounded-full p-0.5">
                  <CheckCircle className="w-3 h-3 text-white" />
                </div>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate(photo.id);
                  }}
                  disabled={isBusy}
                  className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-full p-1 transition-colors z-10"
                  title="Delete photo"
                  aria-label={`Delete ${photo.filename || 'photo'}`}
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              )}
            </div>
          );
        })}

        {!disabled && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors',
              thumbSize,
              'border-[var(--ff-border-light)] hover:border-blue-400 hover:bg-blue-400/5 disabled:opacity-60 disabled:cursor-not-allowed'
            )}
            aria-label="Add photo"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="w-5 h-5 text-[var(--ff-text-secondary)] animate-spin" />
            ) : (
              <>
                <Upload className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                <span className="text-[10px] text-[var(--ff-text-secondary)]">Add</span>
              </>
            )}
          </button>
        )}

        {!disabled && !compact && (
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={isBusy}
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors',
              thumbSize,
              'border-[var(--ff-border-light)] hover:border-blue-400 hover:bg-blue-400/5 disabled:opacity-60 disabled:cursor-not-allowed'
            )}
            aria-label="Take photo with camera"
          >
            <Camera className="w-4 h-4 text-[var(--ff-text-secondary)]" />
            <span className="text-[10px] text-[var(--ff-text-secondary)]">Camera</span>
          </button>
        )}
      </div>

      {!disabled && photos.length === 0 && (
        <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
          Drop, paste, or click to upload — multiple photos allowed
        </p>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-1 text-red-400 text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            aria-label="Close photo preview"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={lightboxUrl}
            alt="Verification photo enlarged"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
