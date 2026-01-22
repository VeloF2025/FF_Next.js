import { Calendar, Eye, Edit, Download, Send } from 'lucide-react';
import { cn } from '@/utils/cn';
import { SOW, SOWMilestone } from '../types/sow.types';

interface SOWTableProps {
  sows: SOW[];
}

function getStatusColor(status: SOW['status']) {
  switch (status) {
    case 'approved':
    case 'completed':
      return 'bg-success-500/20 text-success-400 border-success-500/30';
    case 'active':
      return 'bg-info-500/20 text-info-400 border-info-500/30';
    case 'pending_approval':
      return 'bg-warning-500/20 text-warning-400 border-warning-500/30';
    case 'rejected':
      return 'bg-error-500/20 text-error-400 border-error-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function getMilestoneProgress(milestones: SOWMilestone[]) {
  if (milestones.length === 0) return 0;
  const completed = milestones.filter(m => m.status === 'completed').length;
  return (completed / milestones.length) * 100;
}

export function SOWTable({ sows }: SOWTableProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                SOW Number
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Project
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Client
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Value
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Duration
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Milestones
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {sows.map(sow => (
              <tr key={sow.id} className="hover:bg-[var(--ff-bg-hover)]">
                <td className="px-6 py-4">
                  <div>
                    <div className="font-medium text-[var(--ff-text-primary)]">{sow.sowNumber}</div>
                    <div className="text-xs text-[var(--ff-text-secondary)]">v{sow.version}</div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div>
                    <div className="text-sm text-[var(--ff-text-primary)]">{sow.projectName}</div>
                    {sow.importedData && (
                      <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                        {sow.importedData.poles} poles • {sow.importedData.houses} houses • {sow.importedData.spares} spares • {sow.importedData.fibre} fibre
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-[var(--ff-text-primary)]">{sow.clientName}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                    {sow.currency} {sow.value.toLocaleString()}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-[var(--ff-text-secondary)]">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(sow.startDate).toISOString().split('T')[0]} -
                      {new Date(sow.endDate).toISOString().split('T')[0]}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {sow.milestones.length > 0 ? (
                    <div>
                      <div className="text-sm text-[var(--ff-text-primary)] mb-1">
                        {sow.milestones.filter(m => m.status === 'completed').length}/{sow.milestones.length}
                      </div>
                      <div className="w-20 bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                        <div 
                          className="bg-primary-600 h-2 rounded-full"
                          style={{ width: `${getMilestoneProgress(sow.milestones)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--ff-text-tertiary)]">No milestones</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    'px-2 py-1 text-xs font-medium rounded-full border',
                    getStatusColor(sow.status)
                  )}>
                    {sow.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-1 hover:bg-[var(--ff-bg-hover)] rounded">
                      <Eye className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                    </button>
                    <button className="p-1 hover:bg-[var(--ff-bg-hover)] rounded">
                      <Edit className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                    </button>
                    <button className="p-1 hover:bg-[var(--ff-bg-hover)] rounded">
                      <Download className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                    </button>
                    {sow.status === 'draft' && (
                      <button className="p-1 hover:bg-[var(--ff-bg-hover)] rounded">
                        <Send className="h-4 w-4 text-primary-600" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}