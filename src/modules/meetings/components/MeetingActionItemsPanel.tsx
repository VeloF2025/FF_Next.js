/**
 * Meeting Action Items Panel
 * Interactive action items list: toggle complete, add new, assign, set due dates
 * Replaces the read-only AI-detected action items display
 */

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Circle, Plus, Zap, Calendar, User, Trash2 } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import type { ActionItem, ActionItemPriority } from '@/types/action-items.types';
import type { Meeting } from '../types/meeting.types';

interface MeetingActionItemsPanelProps {
  meeting: Meeting;
}

const PRIORITY_COLORS: Record<ActionItemPriority, string> = {
  urgent: 'bg-red-500/15 text-red-400',
  high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-blue-500/15 text-blue-400',
  low: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]',
};

export function MeetingActionItemsPanel({ meeting }: MeetingActionItemsPanelProps) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const meetingId = Number(meeting.id);
  const hasAiActionItems = meeting.summary?.action_items &&
    (Array.isArray(meeting.summary.action_items)
      ? meeting.summary.action_items.length > 0
      : String(meeting.summary.action_items).trim().length > 0);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await actionItemsService.getActionItems({ meeting_id: meetingId });
      setItems(data);
    } catch (err) {
      log.error('Failed to fetch action items:', err);
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleExtract = async () => {
    setIsExtracting(true);
    try {
      const extracted = await actionItemsService.extractFromMeeting(meetingId);
      setItems(extracted);
    } catch (err) {
      log.error('Failed to extract action items:', err);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleToggleStatus = async (item: ActionItem) => {
    const newStatus = item.status === 'completed' ? 'pending' : 'completed';
    // Optimistic update
    setItems(prev => prev.map(i =>
      i.id === item.id ? { ...i, status: newStatus } : i
    ));
    try {
      await actionItemsService.updateStatus(item.id, newStatus);
    } catch (err) {
      log.error('Failed to toggle action item status:', err);
      setItems(prev => prev.map(i =>
        i.id === item.id ? { ...i, status: item.status } : i
      ));
    }
  };

  const handleAdd = async () => {
    if (!newDescription.trim()) return;
    setIsAdding(true);
    try {
      const created = await actionItemsService.createActionItem({
        meeting_id: meetingId,
        description: newDescription.trim(),
        assignee_name: newAssignee.trim() || undefined,
        due_date: newDueDate || undefined,
      });
      setItems(prev => [...prev, created]);
      setNewDescription('');
      setNewAssignee('');
      setNewDueDate('');
      setShowAddForm(false);
    } catch (err) {
      log.error('Failed to create action item:', err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await actionItemsService.deleteActionItem(id);
    } catch (err) {
      log.error('Failed to delete action item:', err);
      fetchItems();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <InlineSpinner size="sm" />
        <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading action items...</span>
      </div>
    );
  }

  // No items extracted yet — show extract button
  if (items.length === 0 && hasAiActionItems) {
    return (
      <div className="text-center py-12">
        <Zap className="w-10 h-10 mx-auto text-yellow-400 mb-3" />
        <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          AI-detected action items available
        </h3>
        <p className="text-xs text-[var(--ff-text-secondary)] mb-4 max-w-sm mx-auto">
          Extract action items from the meeting summary to track and assign them.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={handleExtract}
          disabled={isExtracting}
          className="inline-flex items-center gap-2"
        >
          {isExtracting ? (
            <InlineSpinner size="sm" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {isExtracting ? 'Extracting...' : 'Extract Action Items'}
        </Button>
      </div>
    );
  }

  const pending = items.filter(i => i.status !== 'completed');
  const completed = items.filter(i => i.status === 'completed');

  // Participants for assignee dropdown
  const participantNames = meeting.rawParticipants?.length
    ? meeting.rawParticipants.map(p => p.displayName || p.name || p.email).filter(Boolean)
    : meeting.participants;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          {items.length} item{items.length !== 1 ? 's' : ''} ({completed.length} completed)
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)] space-y-3">
          <input
            type="text"
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            placeholder="Describe the action item..."
            className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">Assignee</label>
              <select
                value={newAssignee}
                onChange={e => setNewAssignee(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
              >
                <option value="">Unassigned</option>
                {participantNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-[var(--ff-text-tertiary)] mb-1 block">Due date</label>
              <input
                type="date"
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAdd}
              disabled={!newDescription.trim() || isAdding}
              className="flex items-center gap-1.5"
            >
              {isAdding && <InlineSpinner size="sm" />}
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Pending items */}
      {pending.length > 0 && (
        <div className="space-y-1">
          {pending.map(item => (
            <ActionItemRow
              key={item.id}
              item={item}
              onToggle={() => handleToggleStatus(item)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      )}

      {/* Completed items */}
      {completed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-[var(--ff-text-tertiary)] font-medium mt-4 mb-2">Completed</p>
          {completed.map(item => (
            <ActionItemRow
              key={item.id}
              item={item}
              onToggle={() => handleToggleStatus(item)}
              onDelete={() => handleDelete(item.id)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !hasAiActionItems && (
        <div className="text-center py-8">
          <CheckCircle className="w-8 h-8 mx-auto text-[var(--ff-text-tertiary)] mb-2" />
          <p className="text-sm text-[var(--ff-text-secondary)]">No action items yet</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Click &quot;Add Item&quot; to create one manually.
          </p>
        </div>
      )}
    </div>
  );
}

function ActionItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ActionItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isCompleted = item.status === 'completed';
  const isOverdue = item.due_date && !isCompleted && new Date(item.due_date) < new Date();

  return (
    <div className={cn(
      'flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors group',
      isCompleted && 'opacity-60',
    )}>
      <button type="button" onClick={onToggle} className="pt-0.5 flex-shrink-0">
        {isCompleted ? (
          <CheckCircle className="w-4.5 h-4.5 text-green-400" />
        ) : (
          <Circle className="w-4.5 h-4.5 text-[var(--ff-text-tertiary)] hover:text-blue-400 transition-colors" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm text-[var(--ff-text-primary)]',
          isCompleted && 'line-through text-[var(--ff-text-tertiary)]',
        )}>
          {item.description}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {item.assignee_name && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ff-text-tertiary)]">
              <User className="w-3 h-3" />
              {item.assignee_name}
            </span>
          )}
          {item.due_date && (
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px]',
              isOverdue ? 'text-red-400' : 'text-[var(--ff-text-tertiary)]',
            )}>
              <Calendar className="w-3 h-3" />
              {new Date(item.due_date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
            </span>
          )}
          {item.priority && item.priority !== 'medium' && (
            <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded', PRIORITY_COLORS[item.priority])}>
              {item.priority}
            </span>
          )}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDelete}
        title="Delete"
        className="opacity-0 group-hover:opacity-100"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
