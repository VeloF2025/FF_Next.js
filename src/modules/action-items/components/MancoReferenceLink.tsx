'use client';

import { useState, useEffect } from 'react';
import { Link2, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { log } from '@/lib/logger';
import { MancoActionItem } from '@/types/manco-action-items.types';

interface MancoReferenceLinkProps {
  /** The action item whose reference_link is being managed. */
  item: MancoActionItem;
  /** Called after a successful save so the parent can refresh its data. */
  onUpdated: () => void;
}

/**
 * Inline editor for the reference_link field of a manco action item.
 * Displays the current link (read-only) and an editable input + Save button.
 * Validates the URL client-side before submitting, and shows toast feedback.
 */
export function MancoReferenceLink({ item, onUpdated }: MancoReferenceLinkProps) {
  const [linkInput, setLinkInput] = useState<string>(item.reference_link ?? '');
  const [saving, setSaving] = useState(false);

  // Sync input when the item prop changes (e.g. parent refreshes).
  useEffect(() => {
    setLinkInput(item.reference_link ?? '');
  }, [item.id, item.reference_link]);

  const isUnchanged = linkInput === (item.reference_link ?? '');

  const handleSave = async () => {
    const trimmed = linkInput.trim();

    // Client-side URL validation: must be empty (clear) or a valid http(s) URL.
    if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      toast.error('Link must start with http:// or https://');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/manco-action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Send null explicitly to allow clearing the link.
        body: JSON.stringify({ reference_link: trimmed || null }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { message?: string };
        const message = json.message ?? 'Failed to save reference link';
        toast.error(message);
        log.error('Failed to save reference link', { itemId: item.id, status: res.status, message });
        return;
      }

      toast.success('Reference link saved');
      log.info('Reference link saved', { itemId: item.id });
      onUpdated();
    } catch (error) {
      toast.error('Error saving reference link');
      log.error('Error saving reference link', { error, itemId: item.id });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Read-only display */}
      <div className="flex items-center gap-1 mb-1">
        <Link2 className="w-3 h-3 text-[var(--ff-text-secondary)]" />
        <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Reference Link</p>
      </div>

      {item.reference_link ? (
        <a
          href={item.reference_link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-[var(--ff-primary)] hover:underline break-all"
          aria-label={`Open reference link: ${item.reference_link}`}
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          {item.reference_link}
        </a>
      ) : (
        <p className="text-sm text-[var(--ff-text-secondary)]">No link attached</p>
      )}

      {/* Editable input */}
      <div className="mt-3">
        <label
          htmlFor={`manco-reference-link-${item.id}`}
          className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase flex items-center gap-1 mb-2"
        >
          <Link2 className="w-3 h-3" />
          Edit Link
        </label>
        <div className="flex gap-2">
          <input
            id={`manco-reference-link-${item.id}`}
            type="url"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://..."
            className="flex-1 px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-secondary)]"
            aria-label="Reference URL"
          />
          <button
            onClick={handleSave}
            disabled={saving || isUnchanged}
            className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            aria-label="Save reference link"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
