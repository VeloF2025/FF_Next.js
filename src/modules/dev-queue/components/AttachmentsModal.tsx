/**
 * Attachments Modal Component
 * Allows viewing, adding, and deleting attachments for devQueue items
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Paperclip, Link, Image, File, Trash2, Upload, ExternalLink } from 'lucide-react';
import type { DevQueueAttachment } from '../types/devQueue';

interface AttachmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  itemTitle: string;
}

export function AttachmentsModal({ isOpen, onClose, itemId, itemTitle }: AttachmentsModalProps) {
  const [attachments, setAttachments] = useState<DevQueueAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [activeTab, setActiveTab] = useState<'list' | 'add-url' | 'add-file'>('list');
  const [error, setError] = useState<string | null>(null);

  // Handle Escape key to close modal
  const handleEscapeKey = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // Add/remove escape key listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey);
      return () => {
        document.removeEventListener('keydown', handleEscapeKey);
      };
    }
  }, [isOpen, handleEscapeKey]);

  // Fetch attachments
  useEffect(() => {
    if (isOpen && itemId) {
      fetchAttachments();
    }
  }, [isOpen, itemId]);

  const fetchAttachments = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/dev-queue/${itemId}/attachments`);
      if (response.ok) {
        const data = await response.json();
        setAttachments(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch attachments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUrl = async () => {
    if (!urlInput.trim()) {
      setError('Please enter a URL');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      // Determine if it's an image URL
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(urlInput);

      const response = await fetch(`/api/dev-queue/${itemId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput,
          type: isImage ? 'image' : 'url'
        }),
      });

      if (response.ok) {
        setUrlInput('');
        setActiveTab('list');
        await fetchAttachments();
      } else {
        const errData = await response.json();
        setError(errData.error || 'Failed to add URL');
      }
    } catch (err) {
      setError('Failed to add URL');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/dev-queue/${itemId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setActiveTab('list');
        await fetchAttachments();
      } else {
        const errData = await response.json();
        setError(errData.error || 'Failed to upload file');
      }
    } catch (err) {
      setError('Failed to upload file');
    } finally {
      setUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleDelete = async (attachmentId: string) => {
    if (!confirm('Delete this attachment?')) return;

    try {
      const response = await fetch(
        `/api/dev-queue/${itemId}/attachments?attachmentId=${attachmentId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setAttachments(prev => prev.filter(a => a.id !== attachmentId));
      }
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <Image className="h-4 w-4" />;
      case 'url':
        return <Link className="h-4 w-4" />;
      default:
        return <File className="h-4 w-4" />;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Paperclip className="h-5 w-5" />
              Attachments
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)] truncate">{itemTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--ff-border-light)]">
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'list'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            All ({attachments.length})
          </button>
          <button
            onClick={() => setActiveTab('add-url')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'add-url'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <Link className="h-4 w-4 inline mr-1" />
            Add URL
          </button>
          <button
            onClick={() => setActiveTab('add-file')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'add-file'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <Upload className="h-4 w-4 inline mr-1" />
            Upload
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
              {error}
            </div>
          )}

          {activeTab === 'list' && (
            <>
              {loading ? (
                <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
                  Loading...
                </div>
              ) : attachments.length === 0 ? (
                <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
                  <Paperclip className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No attachments yet</p>
                  <p className="text-sm mt-1">Add URLs or upload files</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-3 p-3 bg-[var(--ff-bg-secondary)] rounded-lg group"
                    >
                      {/* Preview/Icon */}
                      <div className="flex-shrink-0">
                        {attachment.type === 'image' ? (
                          <img
                            src={attachment.url}
                            alt={attachment.filename || 'Image'}
                            className="h-12 w-12 object-cover rounded"
                          />
                        ) : (
                          <div className="h-12 w-12 flex items-center justify-center bg-[var(--ff-bg-tertiary)] rounded">
                            {getAttachmentIcon(attachment.type)}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
                          {attachment.filename || attachment.url}
                        </p>
                        <p className="text-xs text-[var(--ff-text-tertiary)]">
                          {attachment.type === 'url' ? 'Link' : formatFileSize(attachment.file_size)}
                          {' • '}
                          {attachment.uploaded_by_name || 'Unknown'}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-[var(--ff-text-tertiary)] hover:text-blue-600 transition-colors"
                          title="Open"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => handleDelete(attachment.id)}
                          className="p-2 text-[var(--ff-text-tertiary)] hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'add-url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  URL
                </label>
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com or image URL"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                />
                <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                  Paste any URL - links, images, documentation, etc.
                </p>
              </div>
              <button
                onClick={handleAddUrl}
                disabled={uploading || !urlInput.trim()}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? 'Adding...' : 'Add URL'}
              </button>
            </div>
          )}

          {activeTab === 'add-file' && (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-colors">
                <Upload className="h-10 w-10 text-[var(--ff-text-tertiary)] mb-2" />
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                  {uploading ? 'Uploading...' : 'Click to upload'}
                </span>
                <span className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                  Images, PDFs, documents up to 10MB
                </span>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
