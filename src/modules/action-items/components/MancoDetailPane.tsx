'use client';

import { useState, useEffect } from 'react';
import { X, MessageCircle, Send, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { MancoActionItem, MancoActionItemComment, MancoMeetingContext } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { useAuth } from '@/contexts/AuthContext';
import { isOverdue } from './manco-grid-helpers';
import { MancoReferenceLink } from './MancoReferenceLink';
import { MancoDocumentUpload } from './MancoDocumentUpload';
import { MancoMeetingContext as MancoMeetingContextSection } from './MancoMeetingContext';
import { MancoItemDetails } from './MancoItemDetails';

interface MancoDetailPaneProps {
  item: MancoActionItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

/**
 * Slide-in detail pane for a manco action item.
 * Shows metadata, meeting context, status editor, reference link, document
 * upload, and a comment thread.
 */
export function MancoDetailPane({
  item,
  isOpen,
  onClose,
  onUpdated,
}: MancoDetailPaneProps) {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<string>(item?.status ?? 'pending');
  const [comments, setComments] = useState<MancoActionItemComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [meetingContext, setMeetingContext] = useState<MancoMeetingContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);

  // Fetch comments and meeting context whenever the selected item changes.
  useEffect(() => {
    if (!item?.id) return;

    const fetchData = async () => {
      setCommentsLoading(true);
      setContextLoading(true);

      try {
        const [commentsRes, contextRes] = await Promise.all([
          fetch(`/api/manco-action-items/comments?item_id=${item.id}`),
          fetch(`/api/manco-action-items/meeting-context?item_id=${item.id}`),
        ]);

        if (commentsRes.ok) {
          const json = await commentsRes.json() as unknown;
          const arr = Array.isArray(json) ? json : ((json as { data?: MancoActionItemComment[] }).data ?? []);
          setComments(arr as MancoActionItemComment[]);
        } else {
          log.error('Failed to load comments', { itemId: item.id, status: commentsRes.status });
        }

        if (contextRes.ok) {
          const contextJson = await contextRes.json() as { data?: MancoMeetingContext } | MancoMeetingContext;
          setMeetingContext((contextJson as { data?: MancoMeetingContext }).data ?? (contextJson as MancoMeetingContext));
        } else {
          log.error('Failed to load meeting context', { itemId: item.id, status: contextRes.status });
        }
      } catch (error) {
        log.error('Error fetching pane data', { error, itemId: item.id });
      } finally {
        setCommentsLoading(false);
        setContextLoading(false);
      }
    };

    void fetchData();
  }, [item?.id]);

  // Sync status selector when item changes.
  useEffect(() => {
    if (item?.status) setStatus(item.status);
  }, [item?.id, item?.status]);

  if (!item || !isOpen) return null;

  // ------------------------------------------------------------------ handlers

  const handleStatusUpdate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/manco-action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { message?: string };
        toast.error(json.message ?? 'Failed to update status');
        log.error('Failed to update status', { itemId: item.id, status: res.status });
        return;
      }

      toast.success('Status updated');
      log.info('Status updated', { itemId: item.id, status });
      onUpdated();
    } catch (error) {
      toast.error('Error updating status');
      log.error('Error updating status', { error });
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setCommentsLoading(true);
    try {
      const res = await fetch('/api/manco-action-items/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manco_action_item_id: item.id,
          author_name: currentUser?.displayName ?? 'Unknown User',
          content: newComment,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { message?: string };
        toast.error(json.message ?? 'Failed to add comment');
        log.error('Failed to add comment', { itemId: item.id, status: res.status });
        return;
      }

      setNewComment('');

      // Reload comments to include the newly posted one.
      const commentsRes = await fetch(`/api/manco-action-items/comments?item_id=${item.id}`);
      if (commentsRes.ok) {
        const json2 = await commentsRes.json() as unknown;
        const arr = Array.isArray(json2) ? json2 : ((json2 as { data?: MancoActionItemComment[] }).data ?? []);
        setComments(arr as MancoActionItemComment[]);
      }
      onUpdated();
    } catch (error) {
      toast.error('Error adding comment');
      log.error('Error adding comment', { error });
    } finally {
      setCommentsLoading(false);
    }
  };

  // --------------------------------------------------------------- status badge

  const statusColor = isOverdue(item) ? 'var(--ff-danger)'
    : item.status === 'pending'     ? 'var(--ff-warning)'
    : item.status === 'in_progress' ? 'var(--ff-info)'
    : item.status === 'completed'   ? 'var(--ff-success)'
    : 'var(--ff-text-secondary)';

  const statusBadgeStyle = {
    background:   `color-mix(in srgb, ${statusColor} 12%, transparent)`,
    color:         statusColor,
    borderColor:  `color-mix(in srgb, ${statusColor} 30%, transparent)`,
  };

  const statusLabel = isOverdue(item)
    ? 'OVERDUE'
    : item.status.replace('_', ' ').toUpperCase();

  // ---------------------------------------------------------------------- JSX

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={onClose}
          style={{ opacity: 1 }}
        />
      )}
      <div
        className={`fixed right-0 top-0 bottom-0 w-[480px] bg-[var(--ff-bg-primary)] shadow-xl z-50 transform transition-transform duration-300 overflow-y-auto ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] p-6 flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-[var(--ff-text-primary)] pr-4">
              {item.action_item}
            </h2>
            <div
              className="mt-2 inline-block px-3 py-1 rounded border text-xs font-medium"
              style={statusBadgeStyle}
            >
              {statusLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Details grid */}
          <MancoItemDetails item={item} />

          {/* Reference link (read + edit) */}
          <MancoReferenceLink item={item} onUpdated={onUpdated} />

          {/* Document (read + upload) */}
          <MancoDocumentUpload
            item={item}
            uploading={docUploading}
            onUploadingChange={setDocUploading}
            onUpdated={onUpdated}
          />

          {/* Notes */}
          {item.comment && (
            <div>
              <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Notes</p>
              <p className="text-sm text-[var(--ff-text-primary)] mt-2 p-3 bg-[var(--ff-bg-secondary)] rounded">
                {item.comment}
              </p>
            </div>
          )}

          {/* Meeting context */}
          <MancoMeetingContextSection context={meetingContext} loading={contextLoading} />

          {/* Status update */}
          <div className="border-t border-[var(--ff-border-light)] pt-6">
            <label className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">
              Update Status
            </label>
            <div className="flex gap-2 mt-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
                aria-label="Select new status"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button
                onClick={handleStatusUpdate}
                disabled={loading || status === item.status}
                className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                aria-label="Save status update"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
              </button>
            </div>
          </div>

          {/* Discussion */}
          <div className="border-t border-[var(--ff-border-light)] pt-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageCircle className="w-4 h-4 text-[var(--ff-text-secondary)]" />
              <p className="text-sm font-semibold text-[var(--ff-text-primary)]">Discussion</p>
            </div>

            <div className="space-y-3 max-h-48 overflow-y-auto mb-4">
              {comments.length === 0 ? (
                <p className="text-xs text-[var(--ff-text-secondary)]">No comments yet</p>
              ) : (
                comments.map((comment) => (
                  <div key={comment.id} className="p-3 bg-[var(--ff-bg-secondary)] rounded text-xs">
                    <p className="font-medium text-[var(--ff-text-primary)]">{comment.author_name}</p>
                    <p className="text-[var(--ff-text-secondary)] text-xs mt-1">
                      {new Date(comment.created_at).toLocaleDateString()}
                    </p>
                    <p className="text-[var(--ff-text-primary)] mt-2">{comment.content}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-secondary)] resize-none"
                rows={2}
              />
              <button
                onClick={handleAddComment}
                disabled={commentsLoading || !newComment.trim()}
                className="px-3 py-2 bg-[var(--ff-primary)] text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 self-end"
                aria-label="Post comment"
              >
                {commentsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
