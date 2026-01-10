import { AlertCircle, MapPin, Users } from 'lucide-react';
import { cn } from '@/utils/cn';
import { FiberSection } from '../types/fiberStringing.types';
import { getStatusColor } from '../utils/fiberUtils';

interface FiberSectionsTableProps {
  sections: FiberSection[];
}

export function FiberSectionsTable({ sections }: FiberSectionsTableProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Section
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Route
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Distance
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Cable Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Progress
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                Team
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {sections.map(section => (
              <tr key={section.id} className="hover:bg-[var(--ff-bg-hover)]">
                <td className="px-6 py-4">
                  <div className="font-medium text-[var(--ff-text-primary)]">{section.sectionName}</div>
                  {section.notes && (
                    <div className="text-sm text-error-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {section.notes}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1 text-sm text-[var(--ff-text-secondary)]">
                    <MapPin className="h-4 w-4" />
                    {section.fromPole} → {section.toPole}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-[var(--ff-text-primary)]">
                  {section.distance}m
                </td>
                <td className="px-6 py-4 text-sm text-[var(--ff-text-primary)]">
                  {section.cableType}
                </td>
                <td className="px-6 py-4">
                  <div className="w-full max-w-[100px]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--ff-text-secondary)]">{section.progress}%</span>
                    </div>
                    <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                      <div 
                        className={cn(
                          'h-2 rounded-full',
                          section.status === 'completed' ? 'bg-success-500' :
                          section.status === 'in_progress' ? 'bg-info-500' :
                          section.status === 'issues' ? 'bg-error-500' :
                          'bg-neutral-400'
                        )}
                        style={{ width: `${section.progress}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    'px-2 py-1 text-xs font-medium rounded-full border',
                    getStatusColor(section.status)
                  )}>
                    {section.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {section.team ? (
                    <div className="flex items-center gap-1 text-sm text-[var(--ff-text-primary)]">
                      <Users className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                      {section.team}
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--ff-text-tertiary)]">Not assigned</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}