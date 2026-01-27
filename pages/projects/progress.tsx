/**
 * Daily Progress Page
 * /projects/progress - Track daily project progress
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { BarChart3, Calendar, TrendingUp } from 'lucide-react';

const DailyProgressPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={projectsConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                Daily Progress
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Track daily installation and project progress
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
              <Calendar className="w-4 h-4" />
              {new Date().toLocaleDateString('en-ZA', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>
          </div>

          {/* Coming Soon Placeholder */}
          <div className="ff-card text-center py-16">
            <div className="flex justify-center gap-4 mb-4">
              <BarChart3 className="w-12 h-12 text-blue-400 opacity-50" />
              <TrendingUp className="w-12 h-12 text-green-400 opacity-50" />
            </div>
            <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              Daily Progress Tracking Coming Soon
            </h3>
            <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto">
              View daily installation counts, team performance metrics, and progress charts.
              This feature is currently under development.
            </p>
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default DailyProgressPage;
