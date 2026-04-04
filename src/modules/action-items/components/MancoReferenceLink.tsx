'use client';

import { useState, useEffect } from 'react';
import { Link2, Loader2, ExternalLink, Plus, X, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'react-hot-toast';
import { log } from '@/lib/logger';
import { MancoActionItem } from '@/types/manco-action-items.types';

interface LinkedMeeting {
  id: string;
  meeting_id: number;
  meeting_title: string;
  meeting_date: string;
}

interface MancoReferenceLinkProps {
  item: MancoActionItem;
  onUpdated: () => void;
}

/**
 * Detect if a URL is a FibreFlow meeting link and extract the meeting ID.
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
 * Reference links + meeting links for a manco action item.
 * Supports multiple meeting links (follow-up meetings) and a general reference link.
 */
export function MancoReferenceLink({ item, onUpdated }: MancoReferenceLinkProps) {
  const [linkInput, setLinkInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkedMeetings, setLinkedMeetings] = useState<LinkedMeeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);

  // Fetch linked meetings
  useEffect(() => {
    if (!item.id) return;
    setLoadingMeetings(true);
    fetch(`/api/manco-action-items/linked-meetings?item_id=${item.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const data = (json as { data?: LinkedMeeting[] })?.data ?? [];
        setLinkedMeetings(data);
      })
      .catch(err => log.error('Failed to fetch linked meetings', { err }))
      .finally(() => setLoadingMeetings(false));
  }, [item.id]);

  const handleAddLink = async () => {
    const trimmed = linkInput.trim();
    if (!trimmed) return;

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      toast.error('Link must start with http:// or https://');
      return;
    }

    const meetingId = parseMeetingId(trimmed);

    setSaving(true);
    try {
      if (meetingId) {
        // It's a meeting link — add to junction table + extract comments
        const res = await fetch('/api/manco-action-items/link-meeting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manco_action_item_id: item.id, meeting_id: meetingId }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({})) as { message?: string };
          toast.error(json.message ?? 'Failed to link meeting');
          return;
        }

        toast.success('Meeting linked — extracting discussion...');
        setLinkInput('');

        // Extract comments fire-and-forget
        fetch('/api/manco-action-items/extract-meeting-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manco_action_item_id: item.id, meeting_id: meetingId }),
        })
          .then(r => r.json())
          .then(json => {
            const count = (json as { data?: { comments_inserted?: number } }).data?.comments_inserted ?? 0;
            if (count > 0) {
              toast.success(`${count} discussion excerpt${count > 1 ? 's' : ''} added as comments`);
            }
            onUpdated();
          })
          .catch(() => onUpdated());
      } else {
        // Regular reference link — save to reference_link field
        const res = await fetch(`/api/manco-action-items/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference_link: trimmed }),
        });

        if (!res.ok) {
          toast.error('Failed to save reference link');
          return;
        }

        toast.success('Reference link saved');
        setLinkInput('');
        onUpdated();
      }
    } catch (error) {
      toast.error('Error saving link');
      log.error('Error saving link', { error, itemId: item.id });
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkMeeting = async (meetingId: number) => {
    try {
      const res = await fetch('/api/manco-action-items/link-meeting', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manco_action_item_id: item.id, meeting_id: meetingId }),
      });
      if (res.ok) {
        toast.success('Meeting unlinked');
        setLinkedMeetings(prev => prev.filter(m => m.meeting_id !== meetingId));
        onUpdated();
      }
    } catch {
      toast.error('Failed to unlink meeting');
    }
  };

  const handleClearReferenceLink = async () => {
    try {
      const res = await fetch(`/api/manco-action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_link: null }),
      });
      if (res.ok) {
        toast.success('Reference link cleared');
        onUpdated();
      }
    } catch {
      toast.error('Failed to clear link');
    }
  };

  return (
    <div className="space-y-4">
      {/* Linked Meetings */}
      <div>
        <div className="flex items-center gap-1 mb-2">
          <Users className="w-3 h-3 text-[var(--ff-text-secondary)]" />
          <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">
            Linked Meetings {linkedMeetings.length > 0 && `(${linkedMeetings.length})`}
          </p>
        </div>

        {loadingMeetings ? (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--ff-text-secondary)]" />
        ) : linkedMeetings.length === 0 ? (
          <p className="text-xs text-[var(--ff-text-secondary)]">No meetings linked</p>
        ) : (
          <div className="space-y-1.5">
            {linkedMeetings.map(m => (
              <div key={m.id} className="flex items-center gap-2 p-2 bg-[var(--ff-bg-secondary)] rounded text-xs group">
                <a
                  href={`/communications?tab=meetings&meeting=${m.meeting_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-[var(--ff-primary)] hover:underline truncate"
                >
                  {m.meeting_title}
                </a>
                <span className="text-[var(--ff-text-tertiary)] whitespace-nowrap">
                  {new Date(m.meeting_date).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { void handleUnlinkMeeting(m.meeting_id); }}
                  title="Unlink meeting"
                  className="opacity-0 group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reference Link (non-meeting) */}
      {item.reference_link && !parseMeetingId(item.reference_link) && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Link2 className="w-3 h-3 text-[var(--ff-text-secondary)]" />
            <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Reference Link</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={item.reference_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-[var(--ff-primary)] hover:underline break-all flex-1"
            >
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              {item.reference_link}
            </a>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { void handleClearReferenceLink(); }}
              title="Clear link"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Add Link Input */}
      <div>
        <label className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase flex items-center gap-1 mb-2">
          <Plus className="w-3 h-3" />
          Add Meeting or Reference Link
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !saving && linkInput.trim() && handleAddLink()}
            placeholder="Paste meeting link or URL..."
            className="flex-1 px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-secondary)]"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => { void handleAddLink(); }}
            disabled={saving || !linkInput.trim()}
            loading={saving}
          >
            Add
          </Button>
        </div>
        <p className="text-[10px] text-[var(--ff-text-tertiary)] mt-1">
          Meeting links auto-detect and extract discussion. Other URLs saved as reference links.
        </p>
      </div>
    </div>
  );
}
