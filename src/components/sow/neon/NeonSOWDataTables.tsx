/**
 * Neon SOW Data Tables for Poles, Drops, and Fibre
 */

import type { SOWPoleRecord, SOWDropRecord, SOWFibreRecord } from './NeonSOWTypes';

interface NeonSOWDataTablesProps {
  data: SOWPoleRecord[] | SOWDropRecord[] | SOWFibreRecord[];
  type: 'poles' | 'drops' | 'fibre';
  title: string;
}

export function NeonSOWDataTables({ data, type, title }: NeonSOWDataTablesProps) {
  const maxItems = 20;
  const displayData = data.slice(0, maxItems);

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{title}</h3>
        <p className="text-[var(--ff-text-secondary)]">No {type} data found</p>
      </div>
    );
  }

  const getStatusBadge = (status: string | undefined, statusType: 'poles' | 'drops' | 'fibre') => {
    let colorClass = 'bg-gray-500/20 text-gray-400';

    if (statusType === 'poles') {
      if (status === 'approved') colorClass = 'bg-green-500/20 text-green-400';
      else if (status === 'pending') colorClass = 'bg-yellow-500/20 text-yellow-400';
    } else if (statusType === 'drops') {
      if (status === 'active') colorClass = 'bg-green-500/20 text-green-400';
      else if (status === 'planned') colorClass = 'bg-blue-500/20 text-blue-400';
    } else if (statusType === 'fibre') {
      if (status === 'installed') colorClass = 'bg-green-500/20 text-green-400';
      else if (status === 'planned') colorClass = 'bg-blue-500/20 text-blue-400';
    }

    return (
      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${colorClass}`}>
        {status ?? 'Unknown'}
      </span>
    );
  };

  const renderPolesTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-[var(--ff-bg-tertiary)]">
        <tr>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Pole Number</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Location</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Status</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">GPS</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--ff-border-light)]">
        {(displayData as SOWPoleRecord[]).map((pole, index: number) => (
          <tr key={index} className="hover:bg-[var(--ff-bg-hover)]">
            <td className="px-4 py-2 font-medium text-[var(--ff-text-primary)]">
              {pole.pole_number ?? pole.id}
            </td>
            <td className="px-4 py-2 text-[var(--ff-text-primary)]">
              {pole.address ?? 'Not specified'}
            </td>
            <td className="px-4 py-2">
              {getStatusBadge(pole.status, 'poles')}
            </td>
            <td className="px-4 py-2 text-[var(--ff-text-secondary)]">
              {pole.latitude && pole.longitude
                ? `${Number(pole.latitude).toFixed(6)}, ${Number(pole.longitude).toFixed(6)}`
                : 'No GPS'
              }
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderDropsTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-[var(--ff-bg-tertiary)]">
        <tr>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Drop Number</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Connected Pole</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Address</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--ff-border-light)]">
        {(displayData as SOWDropRecord[]).map((drop, index: number) => (
          <tr key={index} className="hover:bg-[var(--ff-bg-hover)]">
            <td className="px-4 py-2 font-medium text-[var(--ff-text-primary)]">
              {drop.drop_number ?? drop.id}
            </td>
            <td className="px-4 py-2 text-[var(--ff-text-primary)]">
              {drop.pole_number ?? 'Not assigned'}
            </td>
            <td className="px-4 py-2 text-[var(--ff-text-primary)]">
              {drop.address ?? 'Not specified'}
            </td>
            <td className="px-4 py-2">
              {getStatusBadge(drop.status, 'drops')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderFibreTable = () => (
    <table className="w-full text-sm">
      <thead className="bg-[var(--ff-bg-tertiary)]">
        <tr>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Segment ID</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">From → To</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Distance</th>
          <th className="px-4 py-2 text-left font-medium text-[var(--ff-text-primary)]">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--ff-border-light)]">
        {(displayData as SOWFibreRecord[]).map((segment, index: number) => (
          <tr key={index} className="hover:bg-[var(--ff-bg-hover)]">
            <td className="px-4 py-2 font-medium text-[var(--ff-text-primary)]">
              {segment.segment_id ?? segment.id}
            </td>
            <td className="px-4 py-2 text-[var(--ff-text-primary)]">
              {segment.from_point && segment.to_point
                ? `${segment.from_point} → ${segment.to_point}`
                : 'Not specified'
              }
            </td>
            <td className="px-4 py-2 text-[var(--ff-text-primary)]">
              {segment.distance ? `${segment.distance}m` : 'Unknown'}
            </td>
            <td className="px-4 py-2">
              {getStatusBadge(segment.status, 'fibre')}
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
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{title}</h3>
      <div className="overflow-x-auto">
        {renderTable()}
        {data.length > maxItems && (
          <div className="text-center py-4 text-[var(--ff-text-secondary)] text-sm">
            Showing first {maxItems} of {data.length} {type}
          </div>
        )}
      </div>
    </div>
  );
}
