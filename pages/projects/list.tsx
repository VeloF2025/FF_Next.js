/**
 * Project List Page
 * /projects/list - All projects list view
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { ProjectList } from '@/modules/projects/components/ProjectList';
import Link from 'next/link';
import { Plus } from 'lucide-react';

const ProjectListPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={projectsConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                All Projects
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                View and manage all fiber network projects
              </p>
            </div>
            <Link
              href="/projects/new"
              className="ff-button ff-button--primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Project
            </Link>
          </div>

          {/* Project List Component */}
          <ProjectList />
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default ProjectListPage;
