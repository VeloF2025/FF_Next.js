/**
 * SOW Summary Cards Component
 */

import { MapPin, Home, Cable } from 'lucide-react';

interface SOWSummaryCardsProps {
  polesCount: number;
  dropsCount: number;
  fibreCount: number;
}

export function SOWSummaryCards({ polesCount, dropsCount, fibreCount }: SOWSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-center">
          <MapPin className="h-8 w-8 text-blue-500 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Poles</h3>
            <p className="text-2xl font-bold text-blue-500">{polesCount.toLocaleString()}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Infrastructure poles</p>
          </div>
        </div>
      </div>

      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
        <div className="flex items-center">
          <Home className="h-8 w-8 text-green-500 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Drops</h3>
            <p className="text-2xl font-bold text-green-500">{dropsCount.toLocaleString()}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Home connections</p>
          </div>
        </div>
      </div>

      <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
        <div className="flex items-center">
          <Cable className="h-8 w-8 text-purple-500 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Fibre</h3>
            <p className="text-2xl font-bold text-purple-500">{fibreCount.toLocaleString()}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Cable segments</p>
          </div>
        </div>
      </div>
    </div>
  );
}