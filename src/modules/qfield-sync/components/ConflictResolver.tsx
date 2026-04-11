/**
 * Conflict Resolver Component
 * Interface for resolving sync conflicts between QFieldCloud and FibreFlow
 */

import { useState } from 'react';
import { AlertTriangle, ChevronRight, Check } from 'lucide-react';
import { SyncConflict } from '../types/qfield-sync.types';
import { log } from '@/lib/logger';

interface ConflictResolverProps {
  conflicts: SyncConflict[];
  onResolve: (conflictId: string, resolution: SyncConflict['resolution']) => Promise<void>;
}

export function ConflictResolver({ conflicts, onResolve }: ConflictResolverProps) {
  const [selectedConflict, setSelectedConflict] = useState<SyncConflict | null>(null);
  const [resolving, setResolving] = useState(false);

  const handleResolve = async (resolution: NonNullable<SyncConflict['resolution']>) => {
    if (!selectedConflict) return;

    setResolving(true);
    try {
      await onResolve(selectedConflict.id, resolution);
      setSelectedConflict(null);
    } catch (error) {
      log.error('Failed to resolve conflict', { error, conflictId: selectedConflict.id }, 'ConflictResolver');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow">
      <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Unresolved Conflicts ({conflicts.length})
        </h3>
      </div>

      <div className="divide-y divide-[var(--ff-border-light)]">
        {conflicts.map((conflict) => (
          <div
            key={conflict.id}
            className={`p-6 cursor-pointer hover:bg-[var(--ff-bg-hover)] transition-colors ${
              selectedConflict?.id === conflict.id ? 'bg-blue-500/20' : ''
            }`}
            onClick={() => setSelectedConflict(conflict)}
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                    Record: {conflict.recordId}
                  </span>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">•</span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    Field: {conflict.field}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="bg-green-500/20 p-3 rounded-md">
                    <p className="text-xs font-medium text-green-400 mb-1">QFieldCloud Value:</p>
                    <p className="text-sm text-[var(--ff-text-primary)] font-mono">
                      {JSON.stringify(conflict.qfieldValue)}
                    </p>
                  </div>
                  <div className="bg-blue-500/20 p-3 rounded-md">
                    <p className="text-xs font-medium text-blue-400 mb-1">FibreFlow Value:</p>
                    <p className="text-sm text-[var(--ff-text-primary)] font-mono">
                      {JSON.stringify(conflict.fibreflowValue)}
                    </p>
                  </div>
                </div>

                {conflict.resolution && (
                  <div className="mt-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-600 font-medium">
                      Resolved: {conflict.resolution}
                    </span>
                  </div>
                )}
              </div>

              <ChevronRight className="h-5 w-5 text-[var(--ff-text-tertiary)] ml-4" />
            </div>

            {selectedConflict?.id === conflict.id && !conflict.resolution && (
              <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
                <p className="text-sm text-[var(--ff-text-secondary)] mb-3">Choose resolution:</p>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResolve('use_qfield');
                    }}
                    disabled={resolving}
                    className="px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:bg-gray-400"
                  >
                    Use QField Value
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResolve('use_fibreflow');
                    }}
                    disabled={resolving}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    Use FibreFlow Value
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResolve('skip');
                    }}
                    disabled={resolving}
                    className="px-3 py-1 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 disabled:bg-gray-400"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}