/**
 * SOW Data Table Component
 * Displays paginated SOW data with proper counts
 */

import { cn } from '@/utils/cn';

type SOWRow = Record<string, unknown>;

interface SOWDataTableProps {
  type: 'poles' | 'drops' | 'fibre';
  data: SOWRow[];
  maxRows?: number;
  totalCount?: number; // Actual total count from database (may be larger than data.length)
}

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v);
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

export function SOWDataTable({ type, data, maxRows = 20, totalCount }: SOWDataTableProps) {
  const displayData = data.slice(0, maxRows);
  // Use totalCount if provided, otherwise fall back to data.length
  const actualTotal = totalCount ?? data.length;
  const typeLabel = type === 'fibre' ? 'segments' : type;

  if (data.length === 0) {
    return <p className="text-[var(--ff-text-secondary)]">No {type} data found</p>;
  }

  if (type === 'poles') {
    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Pole Number</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">GPS Coordinates</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Max Drops</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {displayData.map((pole, idx) => (
                <tr key={str(pole.id) || str(pole.pole_number) || idx} className="hover:bg-[var(--ff-bg-tertiary)]">
                  <td className="px-4 py-3 font-medium text-[var(--ff-text-primary)]">
                    {str(pole.pole_number)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                    {pole.latitude && pole.longitude
                      ? `${num(pole.latitude, 0).toFixed(6)}, ${num(pole.longitude, 0).toFixed(6)}`
                      : 'No GPS'
                    }
                  </td>
                  <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                    {num(pole.max_drops, 12)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                      pole.status === 'completed'
                        ? "bg-green-500/20 text-green-400"
                        : pole.status === 'in_progress'
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-gray-500/20 text-gray-400"
                    )}>
                      {str(pole.status, 'planned')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {actualTotal > maxRows && (
          <div className="text-center py-4 text-[var(--ff-text-secondary)] text-sm border-t border-[var(--ff-border-light)]">
            Showing first {maxRows} of {actualTotal.toLocaleString()} {typeLabel}
          </div>
        )}
      </>
    );
  }

  if (type === 'drops') {
    return (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Drop Number</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Pole Number</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Address</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {displayData.map((drop, idx) => (
                <tr key={str(drop.id) || str(drop.drop_number) || idx} className="hover:bg-[var(--ff-bg-tertiary)]">
                  <td className="px-4 py-3 font-medium text-[var(--ff-text-primary)]">
                    {str(drop.drop_number)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                    {str(drop.pole_number, 'Not assigned')}
                  </td>
                  <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                    {str(drop.address, 'Not specified')}
                  </td>
                  <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                    {str(drop.customer_name, '-')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                      drop.status === 'active'
                        ? "bg-green-500/20 text-green-400"
                        : drop.status === 'installed'
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-gray-500/20 text-gray-400"
                    )}>
                      {str(drop.status, 'planned')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {actualTotal > maxRows && (
          <div className="text-center py-4 text-[var(--ff-text-secondary)] text-sm border-t border-[var(--ff-border-light)]">
            Showing first {maxRows} of {actualTotal.toLocaleString()} {typeLabel}
          </div>
        )}
      </>
    );
  }

  // Fibre table
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Segment ID</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">From → To</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Distance</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Cable Type</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Installation</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--ff-text-primary)]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {displayData.map((segment, idx) => (
              <tr key={str(segment.id) || str(segment.segment_id) || idx} className="hover:bg-[var(--ff-bg-tertiary)]">
                <td className="px-4 py-3 font-medium text-[var(--ff-text-primary)]">
                  {str(segment.segment_id)}
                </td>
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                  {str(segment.from_point)} → {str(segment.to_point)}
                </td>
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                  {str(segment.distance)}m
                </td>
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                  {str(segment.cable_type, 'standard')}
                </td>
                <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                  {str(segment.installation_method, 'aerial')}
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                    segment.status === 'installed'
                      ? "bg-green-500/20 text-green-400"
                      : segment.status === 'in_progress'
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-gray-500/20 text-gray-400"
                  )}>
                    {str(segment.status, 'planned')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actualTotal > maxRows && (
        <div className="text-center py-4 text-[var(--ff-text-secondary)] text-sm border-t border-[var(--ff-border-light)]">
          Showing first {maxRows} of {actualTotal.toLocaleString()} {typeLabel}
        </div>
      )}
    </>
  );
}
