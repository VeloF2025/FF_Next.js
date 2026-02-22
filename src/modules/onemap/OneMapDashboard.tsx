'use client';

import { Map, Grid3x3, Download, Upload, Layers, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function OneMapDashboard() {
  const router = useRouter();

  const cards = [
    {
      title: 'Map View',
      description: 'Interactive map visualization',
      icon: Map,
      color: 'bg-blue-500',
      onClick: () => router.push('/onemap/map'),
    },
    {
      title: 'Data Grid',
      description: 'Tabular data view',
      icon: Grid3x3,
      color: 'bg-green-500',
      onClick: () => router.push('/onemap/grid'),
    },
    {
      title: 'Layers',
      description: 'Manage map layers',
      icon: Layers,
      color: 'bg-purple-500',
      onClick: () => router.push('/onemap/layers'),
    },
    {
      title: 'Import Data',
      description: 'Import geographic data',
      icon: Upload,
      color: 'bg-orange-500',
      onClick: () => router.push('/onemap/import'),
    },
    {
      title: 'Export Data',
      description: 'Export to various formats',
      icon: Download,
      color: 'bg-indigo-500',
      onClick: () => router.push('/onemap/export'),
    },
    {
      title: 'Search & Filter',
      description: 'Advanced search capabilities',
      icon: Search,
      color: 'bg-pink-500',
      onClick: () => router.push('/onemap/search'),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">OneMap Data Grid</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Geographic data visualization and management</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div
            key={card.title}
            onClick={card.onClick}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className={`${card.color} p-3 rounded-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">
                  {card.title}
                </h3>
                <p className="text-sm text-[var(--ff-text-secondary)]">{card.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Data Summary */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
          <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Total Points</h3>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">0</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
          <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Active Layers</h3>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">0</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
          <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Last Updated</h3>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">-</p>
        </div>
      </div>
    </div>
  );
}