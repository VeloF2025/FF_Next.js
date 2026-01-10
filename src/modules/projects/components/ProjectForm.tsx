import React from 'react';
import { ProjectFormData } from '@/types/project.types';

interface ProjectFormProps {
  project?: ProjectFormData;
  onSubmit: (data: ProjectFormData) => void;
  onCancel: () => void;
}

export const ProjectForm: React.FC<ProjectFormProps> = ({ project, onSubmit: _onSubmit, onCancel }) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Form submission logic
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
          Project Name
        </label>
        <input
          type="text"
          className="mt-1 block w-full rounded-md border-[var(--ff-border-light)] shadow-sm"
          defaultValue={project?.name}
        />
      </div>

      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Save
        </button>
      </div>
    </form>
  );
};