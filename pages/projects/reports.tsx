/**
 * Project Reports Page
 * /projects/reports - Project analytics and reporting
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { FileBarChart2, Download, Filter } from 'lucide-react';

const ProjectReportsPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={projectsConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                Project Reports
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Analytics and reports for all projects
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="ff-button ff-button--secondary inline-flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filters
              </button>
              <button className="ff-button ff-button--primary inline-flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>

          {/* Coming Soon Placeholder */}
          <div className="ff-card text-center py-16">
            <FileBarChart2 className="w-16 h-16 mx-auto text-[var(--ff-text-secondary)] mb-4 opacity-50" />
            <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              Project Reports Coming Soon
            </h3>
            <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto mb-6">
              Comprehensive project analytics including budget tracking, timeline analysis,
              resource utilization, and performance metrics.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
              <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <h4 className="font-medium text-[var(--ff-text-primary)] mb-1">Budget Reports</h4>
                <p className="text-xs text-[var(--ff-text-secondary)]">Track spending vs allocated budget</p>
              </div>
              <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <h4 className="font-medium text-[var(--ff-text-primary)] mb-1">Timeline Analysis</h4>
                <p className="text-xs text-[var(--ff-text-secondary)]">Project milestones and delays</p>
              </div>
              <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <h4 className="font-medium text-[var(--ff-text-primary)] mb-1">Resource Reports</h4>
                <p className="text-xs text-[var(--ff-text-secondary)]">Team allocation and utilization</p>
              </div>
            </div>
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default ProjectReportsPage;
