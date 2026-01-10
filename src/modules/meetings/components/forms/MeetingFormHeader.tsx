/**
 * Meeting Form Header Component
 * Header section with title and close button for meeting forms
 */

import { X } from 'lucide-react';

interface MeetingFormHeaderProps {
  isEditing: boolean;
  onClose: () => void;
}

export function MeetingFormHeader({ isEditing, onClose }: MeetingFormHeaderProps) {
  return (
    <div className="sticky top-0 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] p-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
        {isEditing ? 'Edit Meeting' : 'New Meeting'}
      </h2>
      <button onClick={onClose} className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-md">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}