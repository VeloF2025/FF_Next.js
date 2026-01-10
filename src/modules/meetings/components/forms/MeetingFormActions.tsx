/**
 * Meeting Form Actions Component
 * Cancel and submit buttons for meeting forms
 */


interface MeetingFormActionsProps {
  isEditing: boolean;
  onCancel: () => void;
}

export function MeetingFormActions({ isEditing, onCancel }: MeetingFormActionsProps) {
  return (
    <div className="flex justify-end space-x-3 pt-4 border-t border-[var(--ff-border-light)]">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
      >
        Cancel
      </button>
      <button
        type="submit"
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
      >
        {isEditing ? 'Update Meeting' : 'Create Meeting'}
      </button>
    </div>
  );
}