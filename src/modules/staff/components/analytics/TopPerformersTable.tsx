/**
 * Top Performers Table Component
 * Displays table of top performing staff members with their metrics
 */

import { formatLabel } from '@/lib/utils';

interface TopPerformer {
  id: string;
  name: string;
  employeeId: string;
  department: string;
  position: string;
  currentProjectCount: number;
  totalProjectsCompleted: number;
  averageProjectRating?: number;
  onTimeCompletionRate: number;
}

interface TopPerformersTableProps {
  topPerformers: TopPerformer[];
}

export function TopPerformersTable({ topPerformers }: TopPerformersTableProps) {
  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  if (!topPerformers || topPerformers.length === 0) {
    return null;
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Top Performers</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)]">
              <th className="text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide pb-3">
                Staff Member
              </th>
              <th className="text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide pb-3">
                Department
              </th>
              <th className="text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide pb-3">
                Position
              </th>
              <th className="text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide pb-3">
                Projects
              </th>
              <th className="text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide pb-3">
                Rating
              </th>
              <th className="text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide pb-3">
                On-Time %
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {topPerformers.slice(0, 5).map((staff) => (
              <tr key={staff.id} className="hover:bg-[var(--ff-bg-hover)]">
                <td className="py-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--ff-text-primary)]">{staff.name}</p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">{staff.employeeId}</p>
                  </div>
                </td>
                <td className="py-3">
                  <span className="text-sm text-[var(--ff-text-secondary)] capitalize">
                    {formatLabel(staff.department)}
                  </span>
                </td>
                <td className="py-3">
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    {staff.position}
                  </span>
                </td>
                <td className="py-3 text-center">
                  <div className="text-sm">
                    <span className="font-medium text-[var(--ff-text-primary)]">{staff.currentProjectCount}</span>
                    <span className="text-[var(--ff-text-secondary)]"> / </span>
                    <span className="text-[var(--ff-text-secondary)]">{staff.totalProjectsCompleted}</span>
                  </div>
                </td>
                <td className="py-3 text-center">
                  <div className="flex items-center justify-center">
                    <span className="text-sm font-medium text-yellow-400">
                      ⭐ {staff.averageProjectRating?.toFixed(1) || 'N/A'}
                    </span>
                  </div>
                </td>
                <td className="py-3 text-center">
                  <span className={`text-sm font-medium ${
                    staff.onTimeCompletionRate >= 0.9 ? 'text-green-400' :
                    staff.onTimeCompletionRate >= 0.7 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {formatPercentage(staff.onTimeCompletionRate)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}