/**
 * Meeting Location Fields Component
 * Virtual meeting checkbox and conditional location/link fields
 */

import { UseFormRegister } from 'react-hook-form';

interface MeetingLocationFieldsProps {
  register: UseFormRegister<any>;
  isVirtual: boolean;
}

export function MeetingLocationFields({ register, isVirtual }: MeetingLocationFieldsProps) {
  return (
    <>
      <div>
        <div className="flex items-center mb-2">
          <input
            {...register('isVirtual')}
            type="checkbox"
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-[var(--ff-border-light)] rounded"
          />
          <label className="ml-2 block text-sm font-medium text-[var(--ff-text-primary)]">
            Virtual Meeting
          </label>
        </div>
      </div>

      {isVirtual ? (
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Meeting Link
          </label>
          <input
            {...register('meetingLink')}
            type="url"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://meet.example.com/room"
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Location
          </label>
          <input
            {...register('location')}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Meeting location"
          />
        </div>
      )}
    </>
  );
}