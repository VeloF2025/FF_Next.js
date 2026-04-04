'use client';

import { useRef } from 'react';
import { FileText, Upload } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { toast } from 'react-hot-toast';
import { log } from '@/lib/logger';
import { MancoActionItem } from '@/types/manco-action-items.types';

interface MancoDocumentUploadProps {
  /** The action item to attach a document to. */
  item: MancoActionItem;
  /** Whether an upload is currently in progress (controlled externally). */
  uploading: boolean;
  /** Called when the uploading state should change. */
  onUploadingChange: (uploading: boolean) => void;
  /** Called after a successful upload + link so the parent can refresh. */
  onUpdated: () => void;
}

/**
 * Document display and file-upload section for a manco action item.
 * Handles: file validation → VF Storage upload → PATCH to link the document.
 * Shows toast feedback on success and failure.
 */
export function MancoDocumentUpload({
  item,
  uploading,
  onUploadingChange,
  onUpdated,
}: MancoDocumentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    onUploadingChange(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch('/api/manco-action-items/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const json = await uploadRes.json().catch(() => ({})) as { message?: string };
        const message = json.message ?? 'Document upload failed';
        toast.error(message);
        log.error('Document upload failed', { itemId: item.id, status: uploadRes.status, message });
        return;
      }

      const { data } = await uploadRes.json() as { data: { url: string; name: string } };

      const patchRes = await fetch(`/api/manco-action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_url: data.url, document_name: data.name }),
      });

      if (!patchRes.ok) {
        const json = await patchRes.json().catch(() => ({})) as { message?: string };
        const message = json.message ?? 'Failed to link document after upload';
        toast.error(message);
        log.error('Failed to link document after upload', { itemId: item.id, status: patchRes.status, message });
        return;
      }

      toast.success(`Document "${data.name}" attached`);
      log.info('Document uploaded and linked', { itemId: item.id, name: data.name });
      onUpdated();
    } catch (error) {
      toast.error('Error uploading document');
      log.error('Error uploading document', { error, itemId: item.id });
    } finally {
      onUploadingChange(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div>
      {/* Read-only display */}
      <div className="flex items-center gap-1 mb-1">
        <FileText className="w-3 h-3 text-[var(--ff-text-secondary)]" />
        <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Document</p>
      </div>

      {item.document_url ? (
        <a
          href={item.document_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-[var(--ff-primary)] hover:underline"
          aria-label={`Download document: ${item.document_name ?? 'document'}`}
        >
          <FileText className="w-3 h-3 flex-shrink-0" />
          {item.document_name ?? 'Download document'}
        </a>
      ) : (
        <p className="text-sm text-[var(--ff-text-secondary)]">No document attached</p>
      )}

      {/* Upload control */}
      <div className="mt-3">
        <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase flex items-center gap-1 mb-2">
          <Upload className="w-3 h-3" />
          Upload Document
        </p>
        <label
          htmlFor={`manco-doc-upload-${item.id}`}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-[var(--ff-border-light)] rounded cursor-pointer hover:border-[var(--ff-primary)] transition-colors"
          aria-label="Choose document to upload"
        >
          {uploading ? (
            <InlineSpinner size="sm" />
          ) : (
            <Upload className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          )}
          <span className="text-sm text-[var(--ff-text-secondary)]">
            {uploading ? 'Uploading...' : 'Choose file (PDF, Word, Excel, image)'}
          </span>
          <input
            id={`manco-doc-upload-${item.id}`}
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
            className="sr-only"
            onChange={handleFileChange}
            disabled={uploading}
            aria-label="Upload document file"
          />
        </label>
      </div>
    </div>
  );
}
