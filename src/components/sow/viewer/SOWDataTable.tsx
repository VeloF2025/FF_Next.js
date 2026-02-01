/**
 * SOW Data Table Component for Poles, Drops, and Fibre
 */

import { CheckCircle } from 'lucide-react';
import { cn } from '@/src/utils/cn';

interface SOWDataTableProps {
  data: any[];
  type: 'poles' | 'drops' | 'fibre';
  maxItems?: number;
}

export function SOWDataTable({ data, type, maxItems = 50 }: SOWDataTableProps) {
  const displayData = data.slice(0, maxItems);
  
  const getStatusBadge = (status: string) => (
    <span className={cn(
      "inline-flex px-2 py-1 text-xs font-medium rounded-full",
      status === 'completed' 
        ? "bg-success-100 text-success-700"
        : status === 'in_progress'
        ? "bg-warning-100 text-warning-700"
        : "bg-[var(--ff-surface-secondary)] text-[var(--ff-text-tertiary)]"
    )}>
      {status || 'planned'}
    </span>
  );

  const renderPolesTable = () => (
    <table className="w-full">
      <thead>
        <tr className="border-b border-[var(--ff-border-primary)]">
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Pole Number
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Coordinates
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Type
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Status
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Municipality
          </th>
        </tr>
      </thead>
      <tbody>
        {displayData.map((pole: any, index: number) => (
          <tr key={pole.id || index} className="border-b border-[var(--ff-border-secondary)] hover:bg-[var(--ff-surface-primary)]">
            <td className="px-4 py-3 text-sm font-medium text-[var(--ff-text-primary)]">
              {pole.pole_number}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {pole.latitude?.toFixed(6)}, {pole.longitude?.toFixed(6)}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {pole.pole_type || '-'}
            </td>
            <td className="px-4 py-3">
              {getStatusBadge(pole.status)}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {pole.municipality || '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderDropsTable = () => (
    <table className="w-full">
      <thead>
        <tr className="border-b border-[var(--ff-border-primary)]">
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Drop Number
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Pole Number
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Address
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Cable Type
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Length
          </th>
        </tr>
      </thead>
      <tbody>
        {displayData.map((drop: any, index: number) => (
          <tr key={drop.id || index} className="border-b border-[var(--ff-border-secondary)] hover:bg-[var(--ff-surface-primary)]">
            <td className="px-4 py-3 text-sm font-medium text-[var(--ff-text-primary)]">
              {drop.drop_number}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {drop.pole_number || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {drop.address || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {drop.cable_type || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {drop.cable_length || '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderFibreTable = () => (
    <table className="w-full">
      <thead>
        <tr className="border-b border-[var(--ff-border-primary)]">
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Segment ID
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Cable Size
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Layer
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Length (m)
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Complete
          </th>
          <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
            Contractor
          </th>
        </tr>
      </thead>
      <tbody>
        {displayData.map((segment: any, index: number) => (
          <tr key={segment.id || index} className="border-b border-[var(--ff-border-secondary)] hover:bg-[var(--ff-surface-primary)]">
            <td className="px-4 py-3 text-sm font-medium text-[var(--ff-text-primary)]">
              {segment.segment_id}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {segment.cable_size || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {segment.layer || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {segment.length?.toLocaleString() || '-'}
            </td>
            <td className="px-4 py-3">
              {segment.is_complete ? (
                <CheckCircle className="w-4 h-4 text-success-600" />
              ) : (
                <span className="text-[var(--ff-text-tertiary)]">-</span>
              )}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
              {segment.contractor || '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderTable = () => {
    switch (type) {
      case 'poles':
        return renderPolesTable();
      case 'drops':
        return renderDropsTable();
      case 'fibre':
        return renderFibreTable();
      default:
        return null;
    }
  };

  return (
    <div className="bg-[var(--ff-background-secondary)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        {renderTable()}
        {data.length > maxItems && (
          <div className="px-4 py-3 text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-surface-secondary)]">
            Showing {maxItems} of {data.length} {type}
          </div>
        )}
      </div>
    </div>
  );
}