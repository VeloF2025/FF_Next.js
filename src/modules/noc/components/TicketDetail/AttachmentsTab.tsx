'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Upload, Image, FileText, Film, Paperclip, Trash2 } from 'lucide-react';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';
import { PhotoLightbox, type LightboxPhoto } from '@/components/PhotoLightbox';
import { useAuth } from '@/contexts/AuthContext';

interface Attachment {
  id: string;
  ticket_id: string;
  filename: string;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_url: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  is_evidence: boolean;
}

interface AttachmentsTabProps {
  ticketId: string;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/');
}

function isVideoMime(mime: string | null): boolean {
  return !!mime && mime.startsWith('video/');
}

export function AttachmentsTab({ ticketId }: AttachmentsTabProps) {
  const { user } = useAuth();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const fetchAttachments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/noc/tickets/${ticketId}/attachments`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setAttachments(json.data?.attachments || []);
      }
    } catch {
      // Silent fail — no user-facing error needed for background fetch
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { fetchAttachments(); }, [fetchAttachments]);

  const userId = user?.id || user?.uid || '';

  const uploadFile = useCallback(async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploaded_by', userId);

      const res = await fetch(`/api/noc/tickets/${ticketId}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (res.ok) {
        fetchAttachments();
      }
    } catch {
      // Silent fail — upload errors surfaced via UI state only
    } finally {
      setUploading(false);
    }
  }, [ticketId, userId, fetchAttachments]);

  // Clipboard paste handler — Ctrl+V anywhere on the page uploads pasted images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            uploadFile(file);
          }
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [uploadFile]);

  const handleDelete = async (attachmentId: string, filename: string) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      const res = await fetch(
        `/api/noc/tickets/${ticketId}/attachments?attachment_id=${attachmentId}`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (res.ok) fetchAttachments();
    } catch {
      // Silent fail
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      uploadFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    for (const file of Array.from(files)) {
      uploadFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  // Build lightbox photo list from image attachments
  const lightboxPhotos: LightboxPhoto[] = useMemo(() =>
    attachments
      .filter(a => isImageMime(a.mime_type) && a.storage_url)
      .map(a => ({ url: a.storage_url!, label: a.filename })),
    [attachments]
  );

  const openLightbox = (att: Attachment) => {
    const idx = lightboxPhotos.findIndex(p => p.url === att.storage_url);
    if (idx >= 0) setLightboxIndex(idx);
  };

  const getFileIcon = (att: Attachment) => {
    if (isImageMime(att.mime_type)) return <Image className="w-5 h-5 text-blue-400" />;
    if (isVideoMime(att.mime_type)) return <Film className="w-5 h-5 text-purple-400" />;
    if (att.file_type === 'pdf') return <FileText className="w-5 h-5 text-red-400" />;
    return <Paperclip className="w-5 h-5 text-[var(--ff-text-secondary)]" />;
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone — drop and paste target (clicking Browse opens file picker) */}
      <div
        ref={dropZoneRef}
        tabIndex={0}
        aria-label="Upload files — drop here, paste, or click Browse"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`bg-[var(--ff-bg-secondary)] border-2 border-dashed rounded-lg p-6 text-center transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none ${
          dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--ff-border-light)]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,application/pdf,.xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />
        {uploading ? (
          <div className="flex items-center justify-center gap-2">
            <InlineSpinner size="sm" />
            <span className="text-sm text-blue-400">Uploading...</span>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-[var(--ff-text-secondary)] mx-auto mb-2" />
            <p className="text-sm text-[var(--ff-text-primary)] font-medium">
              Drop files here or paste from clipboard (Ctrl+V)
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 px-4 py-1.5 text-sm font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-md transition-colors"
            >
              Browse Files
            </button>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-2">
              Photos, videos, PDFs, Excel — max 10MB each
            </p>
          </>
        )}
      </div>

      {/* Attachment Count */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--ff-text-secondary)]">
          {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Attachments Grid */}
      {loading ? (
        <LoadingSpinner className="py-8" size="sm" label="" />
      ) : attachments.length === 0 ? (
        <div className="text-center py-8">
          <Paperclip className="w-10 h-10 mx-auto mb-3 text-[var(--ff-text-secondary)] opacity-40" />
          <p className="text-sm text-[var(--ff-text-secondary)]">No attachments yet</p>
          <p className="text-xs text-[var(--ff-text-secondary)] mt-1">Upload photos or documents to keep evidence with this ticket</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden group"
            >
              {/* Thumbnail / Preview */}
              {isImageMime(att.mime_type) && att.storage_url ? (
                <div
                  className="aspect-square bg-black/20 cursor-pointer relative"
                  onClick={() => openLightbox(att)}
                >
                  <img
                    src={att.storage_url}
                    alt={att.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : isVideoMime(att.mime_type) && att.storage_url ? (
                <div
                  className="aspect-square bg-black/20 flex items-center justify-center cursor-pointer"
                  onClick={() => window.open(att.storage_url!, '_blank')}
                >
                  <Film className="w-10 h-10 text-purple-400" />
                </div>
              ) : (
                <div className="aspect-square bg-[var(--ff-card-bg)] flex items-center justify-center">
                  {getFileIcon(att)}
                </div>
              )}

              {/* Info */}
              <div className="p-2">
                <p className="text-xs text-[var(--ff-text-primary)] truncate font-medium" title={att.filename}>
                  {att.filename}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-[var(--ff-text-secondary)]">
                    {formatFileSize(att.file_size)}
                  </span>
                  <span className="text-[10px] text-[var(--ff-text-secondary)]">
                    {new Date(att.uploaded_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  {att.storage_url && (
                    <a
                      href={att.storage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-blue-400 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open
                    </a>
                  )}
                  <button
                    type="button"
                    aria-label="Delete attachment"
                    onClick={(e) => { e.stopPropagation(); handleDelete(att.id, att.filename); }}
                    className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5 opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Photo Lightbox with zoom/pan/navigation */}
      {lightboxIndex !== null && lightboxPhotos.length > 0 && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
