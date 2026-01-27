/**
 * Tasks Page
 * /projects/tasks - Project task management
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { CheckCircle, Plus } from 'lucide-react';

const TasksPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={projectsConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                Project Tasks
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Manage and track tasks across all projects
              </p>
            </div>
            <button className="ff-button ff-button--primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>

          {/* Coming Soon Placeholder */}
          <div className="ff-card text-center py-16">
            <CheckCircle className="w-16 h-16 mx-auto text-[var(--ff-text-secondary)] mb-4 opacity-50" />
            <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              Task Management Coming Soon
            </h3>
            <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto">
              Track tasks, assignments, and progress across all your fiber network projects.
              This feature is currently under development.
            </p>
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default TasksPage;
