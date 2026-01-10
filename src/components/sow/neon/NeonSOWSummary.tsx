/**
 * Neon SOW Summary View
 */

import { MapPin, Home, Cable } from 'lucide-react';
import { SOWData, NeonHealthData } from './NeonSOWTypes';

interface NeonSOWSummaryProps {
  summary: SOWData['summary'];
  neonHealth?: NeonHealthData;
}

export function NeonSOWSummary({ summary, neonHealth }: NeonSOWSummaryProps) {
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center">
            <MapPin className="h-8 w-8 text-blue-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-blue-900">Poles</h3>
              <p className="text-2xl font-bold text-blue-600">{summary.totalPoles}</p>
              <p className="text-sm text-blue-700">Infrastructure poles</p>
            </div>
          </div>
        </div>
        
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center">
            <Home className="h-8 w-8 text-green-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-green-900">Drops</h3>
              <p className="text-2xl font-bold text-green-600">{summary.totalDrops}</p>
              <p className="text-sm text-green-700">Home connections</p>
            </div>
          </div>
        </div>
        
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center">
            <Cable className="h-8 w-8 text-purple-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-purple-900">Fibre</h3>
              <p className="text-2xl font-bold text-purple-600">{summary.totalFibre}</p>
              <p className="text-sm text-purple-700">Cable segments</p>
            </div>
          </div>
        </div>
      </div>

      {/* Data Source Info */}
      <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
        <h4 className="font-medium text-[var(--ff-text-primary)] mb-3">Data Source</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-[var(--ff-text-secondary)]">Database:</span>
            <span className="ml-2 font-medium">Neon PostgreSQL</span>
          </div>
          <div>
            <span className="text-[var(--ff-text-secondary)]">Tables:</span>
            <span className="ml-2 font-medium">
              {neonHealth?.availableTables?.join(', ') || 'Unknown'}
            </span>
          </div>
          <div>
            <span className="text-[var(--ff-text-secondary)]">Status:</span>
            <span className={`ml-2 font-medium ${
              neonHealth?.connected ? 'text-green-600' : 'text-red-600'
            }`}>
              {neonHealth?.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div>
            <span className="text-[var(--ff-text-secondary)]">Version:</span>
            <span className="ml-2 font-medium text-xs">
              {neonHealth?.info?.version?.split(' ').slice(0, 2).join(' ') || 'Unknown'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}