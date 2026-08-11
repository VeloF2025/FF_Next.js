/**
 * File picker for create forms.
 *
 * Deliberately does no network work. A new record has no id until the server
 * assigns one, and an attachment needs that id for its foreign key, so on a
 * create form the file is held here and uploaded by the form after the record
 * exists. Detail pages use HSAttachmentUpload instead, which uploads directly.
 */

import React, { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_MB,
  formatFileSize,
} from './attachmentClient';

interface HSAttachmentPickerProps {
  label: string;
  /** Held by the parent form so it can upload once the record is created. */
  file: File | null;
  onFileChange: (file: File | null) => void;
  hint?: string;
  disabled?: boolean;
}

const labelCls = 'block text-sm font-medium text-[var(--ff-text-secondary)] mb-1';

export function HSAttachmentPicker({
  label,
  file,
  onFileChange,
  hint,
  disabled = false,
}: HSAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    onFileChange(chosen);
  }

  function clear() {
    onFileChange(null);
    // The input keeps its value after a clear, so re-picking the same file
    // would fire no change event and silently drop the attachment.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>

      {file ? (
        <div className="flex items-center gap-3 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
          <Paperclip className="w-4 h-4 shrink-0 text-[var(--ff-text-secondary)]" />
          <span className="flex-1 min-w-0 truncate text-sm text-[var(--ff-text-primary)]">
            {file.name}
          </span>
          <span className="text-xs text-[var(--ff-text-secondary)] shrink-0">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
            className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-60"
          >
            <X className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          </button>
        </div>
      ) : (
        <label
          className={`flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] border border-dashed border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-secondary)] ${
            disabled ? 'opacity-60' : 'cursor-pointer hover:border-[var(--ff-primary-500)]'
          }`}
        >
          <Paperclip className="w-4 h-4" />
          Choose a file
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_ATTACHMENT_TYPES}
            disabled={disabled}
            onChange={choose}
          />
        </label>
      )}

      <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
        {hint ?? `PDF, JPG, PNG, DOC or DOCX, up to ${MAX_ATTACHMENT_MB} MB.`}
      </p>
    </div>
  );
}
