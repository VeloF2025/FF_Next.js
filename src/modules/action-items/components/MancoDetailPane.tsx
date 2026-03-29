'use client';

import { useState, useEffect } from 'react';
import { X, MessageCircle, Send, Loader2 } from 'lucide-react';
import { MancoActionItem, MancoActionItemComment } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate } from './manco-grid-helpers';

interface MancoDetailPaneProps {
  item: MancoActionItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export function MancoDetailPane({
  item,
  isOpen,
  onClose,
  onUpdated,
}: MancoDetailPaneProps) {
  const { currentUser } = useAuth();
  const [status, setStatus] = useState<string>(item?.status || 'pending');
  const [comments, setComments] = useState<MancoActionItemComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Fetch existing comments whenever the selected item changes
  useEffect(() => {
    if (!item?.id) return;

    const fetchComments = async () => {
      setCommentsLoading(true);
      try {
        const res = await fetch(`/api/manco-action-items/comments?item_id=${item.id}`);
        if (res.ok) {
          const json = await res.json();
          setComments(Array.isArray(json) ? json : (json.data ?? []));
        } else {
          log.error('Failed to load comments', { itemId: item.id, status: res.status });
        }
      } catch (error) {
        log.error('Error fetching comments', { error, itemId: item.id });
      } finally {
        setCommentsLoading(false);
      }
    };

    void fetchComments();
  }, [item?.id]);

  if (!item || !isOpen) return null;

  const handleStatusUpdate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/manco-action-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        onUpdated();
        log.info('Status updated', { itemId: item.id, status });
      }
    } catch (error) {
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
          author_name: currentUser?.displayName || 'Unknown User',
          content: newComment,
        }),
      });
      if (res.ok) {
        setNewComment('');
        // Reload comments to show the newly posted one
        const commentsRes = await fetch(`/api/manco-action-items/comments?item_id=${item.id}`);
        if (commentsRes.ok) {
          const json2 = await commentsRes.json();
          setComments(Array.isArray(json2) ? json2 : (json2.data ?? []));
        }
        onUpdated();
      }
    } catch (error) {
      log.error('Error adding comment', { error });
    } finally {
      setCommentsLoading(false);
    }
  };

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
            <div className="mt-2 inline-block px-3 py-1 rounded text-xs font-medium text-white" style={{
              backgroundColor: item.status === 'pending' ? 'var(--ff-warning)'
                : item.status === 'in_progress' ? 'var(--ff-info)'
                : item.status === 'completed' ? 'var(--ff-success)'
                : 'var(--ff-text-secondary)',
            }}>
              {item.status.replace('_', ' ').toUpperCase()}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Details Grid */}
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            {item.department && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Department</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{item.department}</p>
              </div>
            )}
            {item.responsible_person && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Responsible</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{item.responsible_person}</p>
              </div>
            )}
            {item.logged_date && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Logged</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{formatDate(item.logged_date)}</p>
              </div>
            )}
            {item.completion_eta && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">ETA</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{formatDate(item.completion_eta)}</p>
              </div>
            )}
            {item.completion_date && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Completed</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{formatDate(item.completion_date)}</p>
              </div>
            )}
            {item.fibreflow_module && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">FF Module</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{item.fibreflow_module}</p>
              </div>
            )}
            {item.fibreflow_responsible && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">FF Owner</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{item.fibreflow_responsible}</p>
              </div>
            )}
            {item.fibreflow_dev_status && (
              <div>
                <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">FF Status</p>
                <p className="text-sm text-[var(--ff-text-primary)] mt-1">{item.fibreflow_dev_status}</p>
              </div>
            )}
          </div>

          {/* Notes */}
          {item.comment && (
            <div>
              <p className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Notes</p>
              <p className="text-sm text-[var(--ff-text-primary)] mt-2 p-3 bg-[var(--ff-bg-secondary)] rounded">
                {item.comment}
              </p>
            </div>
          )}

          {/* Status Update */}
          <div className="border-t border-[var(--ff-border-light)] pt-6">
            <label className="text-xs font-semibold text-[var(--ff-text-secondary)] uppercase">Update Status</label>
            <div className="flex gap-2 mt-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
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
