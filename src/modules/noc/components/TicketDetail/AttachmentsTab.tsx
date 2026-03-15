'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Image, FileText, Film, Paperclip, X } from 'lucide-react';
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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

  const getFileIcon = (att: Attachment) => {
    if (isImageMime(att.mime_type)) return <Image className="w-5 h-5 text-blue-400" />;
    if (isVideoMime(att.mime_type)) return <Film className="w-5 h-5 text-purple-400" />;
    if (att.file_type === 'pdf') return <FileText className="w-5 h-5 text-red-400" />;
    return <Paperclip className="w-5 h-5 text-[var(--ff-text-secondary)]" />;
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        ref={dropZoneRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`bg-[var(--ff-bg-secondary)] border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--ff-border-light)] hover:border-blue-500/50'
        }`}
        onClick={() => fileInputRef.current?.click()}
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
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500" />
            <span className="text-sm text-blue-400">Uploading...</span>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-[var(--ff-text-secondary)] mx-auto mb-2" />
            <p className="text-sm text-[var(--ff-text-primary)] font-medium">
              Drop files here, click to browse, or paste from clipboard
            </p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
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
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500" />
        </div>
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
                  onClick={() => setPreviewUrl(att.storage_url)}
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
                  onClick={() => setPreviewUrl(att.storage_url)}
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
                {att.storage_url && (
                  <a
                    href={att.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-400 hover:underline mt-1 block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open original
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-size Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          style={{ zIndex: 99999 }}
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70"
          >
            <X className="w-6 h-6" />
          </button>
          {previewUrl.match(/\.(mp4|webm|mov|avi)$/i) ? (
            <video
              src={previewUrl}
              controls
              className="max-w-full max-h-[90vh] rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={previewUrl}
              alt="Preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
