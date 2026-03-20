/**
 * SOW Summary Cards Component
 */

import { MapPin, Home, Cable, Layers, Network } from 'lucide-react';

interface SOWSummaryCardsProps {
  polesCount: number;
  dropsCount: number;
  fibreCount: number;
  zonesCount?: number;
  ponsCount?: number;
}

export function SOWSummaryCards({ polesCount, dropsCount, fibreCount, zonesCount = 0, ponsCount = 0 }: SOWSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
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

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <div className="flex items-center">
          <Layers className="h-8 w-8 text-amber-500 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Zones</h3>
            <p className="text-2xl font-bold text-amber-500">{zonesCount.toLocaleString()}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Coverage zones</p>
          </div>
        </div>
      </div>

      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
        <div className="flex items-center">
          <Network className="h-8 w-8 text-cyan-500 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">PONs</h3>
            <p className="text-2xl font-bold text-cyan-500">{ponsCount.toLocaleString()}</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">Passive optical networks</p>
          </div>
        </div>
      </div>
    </div>
  );
}