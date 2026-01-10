import { UseFormReturn } from 'react-hook-form';
import Link from 'next/link';
import { ProjectPriority, ProjectStatus } from '../../../types/project.types';
import type { FormData } from '../types';

interface ProjectDetailsStepProps {
  form: UseFormReturn<FormData>;
  projectManagers: Array<{ id: string; name: string }>;
  isProjectManagersLoading: boolean;
}

export function ProjectDetailsStep({ 
  form, 
  projectManagers, 
  isProjectManagersLoading 
}: ProjectDetailsStepProps) {
  const { register, formState: { errors } } = form;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Budget (R)
          </label>
          <input
            {...register('budget.totalBudget', {
              min: { value: 0, message: 'Budget must be positive' },
              valueAsNumber: true
            })}
            type="number"
            step="0.01"
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0.00"
          />
          {errors.budget?.totalBudget && (
            <p className="mt-1 text-sm text-red-600">{errors.budget.totalBudget.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Priority *
          </label>
          <select
            {...register('priority', { required: 'Priority is required' })}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={ProjectPriority.LOW}>Low</option>
            <option value={ProjectPriority.MEDIUM}>Medium</option>
            <option value={ProjectPriority.HIGH}>High</option>
            <option value={ProjectPriority.CRITICAL}>Critical</option>
          </select>
          {errors.priority && (
            <p className="mt-1 text-sm text-red-600">{errors.priority.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
            Status
          </label>
          <select
            {...register('status' as any)}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={ProjectStatus.PLANNING}>Planning</option>
            <option value={ProjectStatus.ACTIVE}>Active</option>
            <option value={ProjectStatus.ON_HOLD}>On Hold</option>
            <option value={ProjectStatus.COMPLETED}>Completed</option>
            <option value={ProjectStatus.CANCELLED}>Cancelled</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
            Project Manager *
          </label>
          <Link
            href="/staff"
            target="_blank"
            className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
          >
            Manage Staff →
          </Link>
        </div>
        {isProjectManagersLoading ? (
          <div className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
            Loading project managers...
          </div>
        ) : (
          <>
            <select
              {...register('projectManagerId', { required: 'Project Manager is required' })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select project manager</option>
              {projectManagers?.map(pm => (
                <option key={pm.id} value={pm.id}>
                  {pm.name}
                </option>
              ))}
            </select>
            {projectManagers.length === 0 && (
              <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">
                No project managers available.
                <Link href="/staff/new" target="_blank" className="ml-1 text-blue-600 hover:text-blue-800 hover:underline">
                  Add a staff member
                </Link>
              </p>
            )}
          </>
        )}
        {errors.projectManagerId && (
          <p className="mt-1 text-sm text-red-600">{errors.projectManagerId.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Team Members
        </label>
        <div className="text-sm text-[var(--ff-text-secondary)]">
          Team members can be assigned after project creation
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
          Notes
        </label>
        <textarea
          {...register('description')}
          rows={4}
          className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Additional notes or requirements"
        />
      </div>
    </div>
  );
}