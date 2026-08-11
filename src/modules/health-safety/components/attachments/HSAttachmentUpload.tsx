/**
 * Attachment list and uploader for a record that already exists.
 *
 * Every H&S surface that holds documents renders this, so there is one upload
 * path to secure and one to test. Downloads go through the authenticated route
 * — the bytes are behind an nginx 403 and are not linkable.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Paperclip, Download, Trash2, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import type { AttachmentSurface } from '../../services/hsAttachmentPolicy';
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_MB,
  attachmentDownloadUrl,
  deleteAttachment,
  formatFileSize,
  listAttachments,
  uploadAttachment,
  type AttachmentSummary,
} from './attachmentClient';

interface HSAttachmentUploadProps {
  surface: AttachmentSurface;
  parentId: string;
  label?: string;
  /** Hides the upload control and the delete buttons. */
  readOnly?: boolean;
}

const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

export function HSAttachmentUpload({
  surface,
  parentId,
  label = 'Attachments',
  readOnly = false,
}: HSAttachmentUploadProps) {
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAttachments(await listAttachments(surface, parentId));
      setError(null);
    } catch (err) {
      // Surfaced rather than swallowed: an empty list and a failed list look
      // identical, and "no certificate on file" is a compliance conclusion.
      setError(err instanceof Error ? err.message : 'Failed to load attachments');
      log.error('Failed to load H&S attachments', { error: err }, 'HSAttachmentUpload');
    } finally {
      setLoading(false);
    }
  }, [surface, parentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file still fires a change event.
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      await uploadAttachment(surface, parentId, file);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload the file');
      log.error('H&S attachment upload failed', { error: err }, 'HSAttachmentUpload');
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachment: AttachmentSummary) {
    setBusy(true);
    setError(null);
    try {
      await deleteAttachment(attachment.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove the attachment');
      log.error('H&S attachment delete failed', { error: err }, 'HSAttachmentUpload');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>

      {error && (
        <div className="mb-2 p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <ul className="space-y-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg"
            >
              <Paperclip className="w-4 h-4 shrink-0 text-[var(--ff-text-secondary)]" />
              <span className="flex-1 min-w-0 truncate text-sm text-[var(--ff-text-primary)]">
                {attachment.file_name}
              </span>
              <span className="text-xs text-[var(--ff-text-secondary)] shrink-0">
                {formatFileSize(attachment.file_size)}
              </span>
              <a
                href={attachmentDownloadUrl(attachment.id)}
                className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)]"
                aria-label={`Download ${attachment.file_name}`}
              >
                <Download className="w-4 h-4 text-[var(--ff-text-secondary)]" />
              </a>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void remove(attachment)}
                  disabled={busy}
                  aria-label={`Remove ${attachment.file_name}`}
                  className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              )}
            </li>
          ))}

          {attachments.length === 0 && (
            <li className="text-sm text-[var(--ff-text-secondary)]">No documents attached.</li>
          )}
        </ul>
      )}

      {!readOnly && (
        <label
          className={`mt-2 inline-flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-dashed border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-secondary)] ${
            busy ? 'opacity-60' : 'cursor-pointer hover:border-[var(--ff-primary-500)]'
          }`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          {busy ? 'Uploading…' : 'Upload a document'}
          <input
            type="file"
            className="hidden"
            accept={ACCEPTED_ATTACHMENT_TYPES}
            disabled={busy}
            onChange={upload}
          />
        </label>
      )}

      {!readOnly && (
        <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
          PDF, JPG, PNG, DOC or DOCX, up to {MAX_ATTACHMENT_MB} MB.
        </p>
      )}
    </div>
  );
}
