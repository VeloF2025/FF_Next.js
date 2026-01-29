/**
 * Projects Dashboard Page
 * /projects - Portfolio overview and KPIs
 */

import type { NextPage } from 'next';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { PortfolioDashboard } from '@/modules/projects/components/Dashboard';
import { Plus } from 'lucide-react';

const ProjectsDashboardPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage
        config={projectsConfig}
        headerActions={
          <Link
            href="/projects/new"
            className="ff-button ff-button--primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Project
          </Link>
        }
      >
        <PortfolioDashboard />
      </ModulePage>
    </AppLayout>
  );
};

export default ProjectsDashboardPage;
