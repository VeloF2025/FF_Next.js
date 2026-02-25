import React from 'react';
import { MapPin, Home, Cable, Camera, CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDisplayDateTime } from '@/utils/dateFormat';
import { TrackerItem } from '../types/tracker.types';

interface TrackerTableProps {
  data: TrackerItem[];
  isLoading: boolean;
  expandedRows: Set<string>;
  toggleRowExpansion: (id: string) => void;
}

export function TrackerTable({ data, isLoading, expandedRows, toggleRowExpansion }: TrackerTableProps) {
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'pole': return <MapPin className="w-4 h-4" />;
      case 'drop': return <Home className="w-4 h-4" />;
      case 'fiber': return <Cable className="w-4 h-4" />;
      default: return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400 bg-green-500/20';
      case 'in_progress': return 'text-blue-400 bg-blue-500/20';
      case 'issue': return 'text-red-400 bg-red-500/20';
      default: return 'text-gray-400 bg-gray-500/20';
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Identifier</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Location</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Phase</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Progress</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Photos</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">QC</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Updated</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  Loading tracker data...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  No items found matching your filters
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <React.Fragment key={item.id}>
                  <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(item.type)}
                        <span className="text-xs font-medium uppercase text-[var(--ff-text-secondary)]">
                          {item.type}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--ff-text-primary)]">{item.identifier}</td>
                    <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">{item.location}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-[var(--ff-text-secondary)]">{item.phase}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              item.progress === 100 ? 'bg-green-500' :
                              item.progress >= 50 ? 'bg-blue-500' :
                              'bg-yellow-500'
                            }`}
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-[var(--ff-text-secondary)]">{item.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Camera className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                        <span className="text-sm text-[var(--ff-text-primary)]">{item.photos}/{item.totalPhotos}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {item.qualityChecks === item.totalChecks ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                        )}
                        <span className="text-sm text-[var(--ff-text-primary)]">{item.qualityChecks}/{item.totalChecks}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
                      {item.lastUpdated ? formatDisplayDateTime(item.lastUpdated) : 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRowExpansion(item.id)}
                        className="p-1 hover:bg-[var(--ff-bg-hover)] rounded"
                      >
                        {expandedRows.has(item.id) ? (
                          <ChevronUp className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedRows.has(item.id) && (
                    <tr className="bg-[var(--ff-bg-tertiary)]">
                      <td colSpan={10} className="px-8 py-4">
                        <TrackerRowDetails item={item} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrackerRowDetails({ item }: { item: TrackerItem }) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <h4 className="font-medium mb-2 text-[var(--ff-text-primary)]">Details</h4>
        <dl className="space-y-1">
          {item.type === 'pole' && (
            <div className="flex justify-between">
              <dt className="text-[var(--ff-text-secondary)]">Drop Count:</dt>
              <dd className="font-medium text-[var(--ff-text-primary)]">{item.metadata?.dropCount || 0}/12</dd>
            </div>
          )}
          {item.type === 'drop' && (
            <>
              <div className="flex justify-between">
                <dt className="text-[var(--ff-text-secondary)]">Pole Number:</dt>
                <dd className="font-medium text-[var(--ff-text-primary)]">{item.metadata?.poleNumber || 'N/A'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ff-text-secondary)]">Home Owner:</dt>
                <dd className="font-medium text-[var(--ff-text-primary)]">{item.metadata?.homeOwner || 'N/A'}</dd>
              </div>
            </>
          )}
          {item.type === 'fiber' && (
            <>
              <div className="flex justify-between">
                <dt className="text-[var(--ff-text-secondary)]">Length:</dt>
                <dd className="font-medium text-[var(--ff-text-primary)]">{item.metadata?.length || 0}m</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ff-text-secondary)]">Cable Type:</dt>
                <dd className="font-medium text-[var(--ff-text-primary)]">{item.metadata?.cableType || 'N/A'}</dd>
              </div>
            </>
          )}
        </dl>
      </div>
      <div>
        <h4 className="font-medium mb-2 text-[var(--ff-text-primary)]">Actions</h4>
        <div className="space-y-2">
          <button className="w-full px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
            View Details
          </button>
          <button className="w-full px-3 py-1 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)]">
            Update Status
          </button>
        </div>
      </div>
    </div>
  );
}