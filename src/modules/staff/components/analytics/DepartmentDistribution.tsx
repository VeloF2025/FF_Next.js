/**
 * Department Distribution Component
 * Displays staff distribution across departments with progress bars
 */

import { PieChart } from 'lucide-react';
import { formatLabel } from '@/lib/utils';

interface DepartmentDistributionProps {
  staffByDepartment: Record<string, number>;
  totalStaff: number;
}

export function DepartmentDistribution({ staffByDepartment, totalStaff }: DepartmentDistributionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Department Distribution</h3>
        <PieChart className="w-5 h-5 text-[var(--ff-text-secondary)]" />
      </div>
      <div className="space-y-3">
        {Object.entries(staffByDepartment).map(([dept, count]) => {
          const percentage = (count / totalStaff) * 100;
          return (
            <div key={dept}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-[var(--ff-text-secondary)] capitalize">
                  {formatLabel(dept)}
                </span>
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                  {count} ({percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full bg-[var(--ff-border-light)] rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}