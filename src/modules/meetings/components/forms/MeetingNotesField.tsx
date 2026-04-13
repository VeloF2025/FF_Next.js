/**
 * Meeting Notes Field Component
 * Notes textarea field for additional meeting information
 */

import { UseFormRegister, FieldValues } from 'react-hook-form';

interface MeetingNotesFieldProps {
  register: UseFormRegister<FieldValues>;
}

export function MeetingNotesField({ register }: MeetingNotesFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
        Notes
      </label>
      <textarea
        {...register('notes')}
        rows={3}
        className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Additional meeting notes"
      />
    </div>
  );
}