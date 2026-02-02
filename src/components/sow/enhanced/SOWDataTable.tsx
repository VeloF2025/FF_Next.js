/**
 * SOW Data Table Component
 * Displays paginated SOW data with proper counts
 */

import { cn } from '@/utils/cn';

interface SOWDataTableProps {
  type: 'poles' | 'drops' | 'fibre';
  data: any[];
  maxRows?: number;
  totalCount?: number; // Actual total count from database (may be larger than data.length)
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
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Pole Number</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">GPS Coordinates</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Max Drops</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {displayData.map((pole: any) => (
                <tr key={pole.id || pole.pole_number} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {pole.pole_number}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {pole.latitude && pole.longitude 
                      ? `${Number(pole.latitude).toFixed(6)}, ${Number(pole.longitude).toFixed(6)}`
                      : 'No GPS'
                    }
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {pole.max_drops || 12}
                  </td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                      pole.status === 'completed' 
                        ? "bg-green-100 text-green-800"
                        : pole.status === 'in_progress'
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-800"
                    )}>
                      {pole.status || 'planned'}
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
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Drop Number</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Pole Number</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Address</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Customer</th>
                <th className="px-4 py-2 text-left font-medium text-gray-900">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {displayData.map((drop: any) => (
                <tr key={drop.id || drop.drop_number} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {drop.drop_number}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {drop.pole_number || 'Not assigned'}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {drop.address || 'Not specified'}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {drop.customer_name || '-'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                      drop.status === 'active' 
                        ? "bg-green-100 text-green-800"
                        : drop.status === 'installed'
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-800"
                    )}>
                      {drop.status || 'planned'}
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
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-900">Segment ID</th>
              <th className="px-4 py-2 text-left font-medium text-gray-900">From → To</th>
              <th className="px-4 py-2 text-left font-medium text-gray-900">Distance</th>
              <th className="px-4 py-2 text-left font-medium text-gray-900">Cable Type</th>
              <th className="px-4 py-2 text-left font-medium text-gray-900">Installation</th>
              <th className="px-4 py-2 text-left font-medium text-gray-900">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayData.map((segment: any) => (
              <tr key={segment.id || segment.segment_id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-900">
                  {segment.segment_id}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {segment.from_point} → {segment.to_point}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {segment.distance}m
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {segment.cable_type || 'standard'}
                </td>
                <td className="px-4 py-2 text-gray-700">
                  {segment.installation_method || 'aerial'}
                </td>
                <td className="px-4 py-2">
                  <span className={cn(
                    "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                    segment.status === 'installed' 
                      ? "bg-green-100 text-green-800"
                      : segment.status === 'in_progress'
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-gray-100 text-gray-800"
                  )}>
                    {segment.status || 'planned'}
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