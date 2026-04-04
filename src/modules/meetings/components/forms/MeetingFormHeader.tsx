/**
 * Meeting Form Header Component
 * Header section with title and close button for meeting forms
 */

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
        <X className="w-5 h-5" />
      </Button>
    </div>
  );
}