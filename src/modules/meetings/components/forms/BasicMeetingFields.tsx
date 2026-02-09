/**
 * Basic Meeting Fields Component
 * Basic meeting information form fields (title, type, status, date, time, duration, organizer)
 */

import { UseFormRegister, FieldErrors } from 'react-hook-form';

interface BasicMeetingFieldsProps {
  register: UseFormRegister<any>;
  errors: FieldErrors<any>;
}

export function BasicMeetingFields({ register, errors }: BasicMeetingFieldsProps) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Meeting Title *
        </label>
        <input
          {...register('title', { required: 'Title is required' })}
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter meeting title"
        />
        {errors.title?.message && (
          <p className="mt-1 text-sm text-red-600">{String(errors.title.message)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Type
          </label>
          <select
            {...register('type')}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="team">Team Meeting</option>
            <option value="client">Client Meeting</option>
            <option value="board">Board Meeting</option>
            <option value="standup">Standup</option>
            <option value="review">Review</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Status
          </label>
          <select
            {...register('status')}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Date *
          </label>
          <input
            {...register('date', { required: 'Date is required' })}
            type="date"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.date?.message && (
            <p className="mt-1 text-sm text-red-600">{String(errors.date.message)}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Time *
          </label>
          <input
            {...register('time', { required: 'Time is required' })}
            type="time"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.time?.message && (
            <p className="mt-1 text-sm text-red-600">{String(errors.time.message)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Duration
          </label>
          <input
            {...register('duration')}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., 1h 30min"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Organizer
          </label>
          <input
            {...register('organizer')}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Meeting organizer"
          />
        </div>
      </div>
    </>
  );
}