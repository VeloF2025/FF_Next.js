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
 * Detect if a URL is a FibreFlow meeting link and extract the meeting ID.
 * Matches: /communications?tab=meetings&meeting={id}
 */
function parseMeetingId(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.pathname === '/communications' &&
      parsed.searchParams.get('tab') === 'meetings' &&
      parsed.searchParams.get('meeting')
    ) {
      const id = parseInt(parsed.searchParams.get('meeting')!, 10);
      return Number.isFinite(id) && id > 0 ? id : null;
    }
  } catch { /* not a valid URL */ }
  return null;
}

/**
 * Inline editor for the reference_link field of a manco action item.
 * Displays the current link (read-only) and an editable input + Save button.
 * Auto-detects meeting URLs and links the meeting context + extracts discussion.
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

    // Detect meeting URL
    const meetingId = trimmed ? parseMeetingId(trimmed) : null;

    setSaving(true);
    try {
      // Build PATCH body — include source_meeting_id if meeting URL detected or cleared
      const patchBody: Record<string, unknown> = {
        reference_link: trimmed || null,
      };
      if (meetingId) {
        patchBody.source_meeting_id = meetingId;
      } else if (!trimmed) {
        // Clearing the link also clears the meeting association
        patchBody.source_meeting_id = null;
      }

      const res = await fetch(`/api/manco-action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { message?: string };
        const message = json.message ?? 'Failed to save reference link';
        toast.error(message);
        log.error('Failed to save reference link', { itemId: item.id, status: res.status, message });
        return;
      }

      if (meetingId) {
        toast.success('Meeting linked — extracting discussion...');

        // Fire-and-forget: extract relevant transcript excerpts as comments
        fetch('/api/manco-action-items/extract-meeting-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manco_action_item_id: item.id,
            meeting_id: meetingId,
          }),
        })
          .then(r => r.json())
          .then(json => {
            const count = (json as { data?: { comments_inserted?: number } }).data?.comments_inserted ?? 0;
            if (count > 0) {
              toast.success(`${count} discussion excerpt${count > 1 ? 's' : ''} added as comments`);
            }
            onUpdated(); // Refresh to show new comments + meeting context
          })
          .catch(err => {
            log.error('Failed to extract meeting comments', { err, itemId: item.id, meetingId });
            onUpdated(); // Still refresh for the meeting context link
          });
      } else {
        toast.success('Reference link saved');
        onUpdated();
      }

      log.info('Reference link saved', { itemId: item.id, meetingId });
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
