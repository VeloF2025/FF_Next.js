// ============= Project KPI Section Component =============

import { Button } from '@/shared/components/ui/Button';
import type { ProjectStats } from '../types/types';

interface ProjectKPISectionProps {
  projectName: string;
  projectCode: string;
  stats: ProjectStats;
  onNavigate: (path: string) => void;
}

export function ProjectKPISection({
  projectName,
  projectCode,
  stats,
  onNavigate
}: ProjectKPISectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{projectName}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{projectCode} - Project KPI Summary</p>
        </div>
        <Button
          onClick={() => onNavigate('/app/procurement/reports')}
          variant="outline"
          size="sm"
        >
          Full Report
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="text-center p-4 bg-blue-50 rounded-lg">
          <div className="text-2xl font-bold text-blue-600 mb-1">
            R {stats.boq.totalValue.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total BOQ Value</div>
        </div>
        <div className="text-center p-4 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-600 mb-1">12.5%</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Cost Savings</div>
        </div>
        <div className="text-center p-4 bg-purple-50 rounded-lg">
          <div className="text-2xl font-bold text-purple-600 mb-1">14.5</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Avg Cycle Days</div>
        </div>
        <div className="text-center p-4 bg-orange-50 rounded-lg">
          <div className="text-2xl font-bold text-orange-600 mb-1">92%</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Supplier OTIF</div>
        </div>
      </div>
    </div>
  );
}
