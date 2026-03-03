/**
 * Create Action Item Modal
 * Standalone modal for creating action items without a specific meeting context
 */

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { actionItemsService } from '@/services/action-items/actionItemsService';
import type { ActionItemPriority } from '@/types/action-items.types';

interface CreateActionItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

interface MeetingOption {
  id: number;
  title: string;
}

export function CreateActionItemModal({ isOpen, onClose, onCreated }: CreateActionItemModalProps) {
  const [description, setDescription] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [priority, setPriority] = useState<ActionItemPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [meetingId, setMeetingId] = useState<number | ''>('');
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // Fetch recent meetings for the dropdown
    fetch('/api/meetings')
      .then(r => r.json())
      .then(data => {
        const list = (data.meetings || []).map((m: { id: number; title: string }) => ({
          id: m.id,
          title: m.title,
        }));
        setMeetings(list);
      })
      .catch(err => log.error('Failed to fetch meetings for action item modal:', err));
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!description.trim() || !meetingId) return;
    setIsSubmitting(true);
    try {
      await actionItemsService.createActionItem({
        meeting_id: Number(meetingId),
        description: description.trim(),
        assignee_name: assigneeName.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
      });
      // Reset form
      setDescription('');
      setAssigneeName('');
      setPriority('medium');
      setDueDate('');
      setMeetingId('');
      onCreated?.();
      onClose();
    } catch (err) {
      log.error('Failed to create action item:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg max-w-lg w-full">
        <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">New Action Item</h2>
          <button onClick={onClose} className="p-2 hover:bg-[var(--ff-bg-hover)] rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Meeting selector */}
          <div>
            <label className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 block">Meeting</label>
            <select
              value={meetingId}
              onChange={e => setMeetingId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
            >
              <option value="">Select a meeting...</option>
              {meetings.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What needs to be done?"
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
            />
          </div>

          {/* Assignee + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 block">Assignee</label>
              <input
                type="text"
                value={assigneeName}
                onChange={e => setAssigneeName(e.target.value)}
                placeholder="Name (optional)"
                className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as ActionItemPriority)}
                className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="text-sm font-medium text-[var(--ff-text-primary)] mb-1 block">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]/50"
            />
          </div>
        </div>

        <div className="p-4 border-t border-[var(--ff-border-light)] flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="ff-button ff-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!description.trim() || !meetingId || isSubmitting}
            className="ff-button ff-button-primary flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
