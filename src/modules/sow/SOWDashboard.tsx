'use client';

import { FileSpreadsheet, Upload, Download, Search, CheckCircle, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function SOWDashboard() {
  const router = useRouter();

  const cards = [
    {
      title: 'Import SOW',
      description: 'Import SOW data from Excel',
      icon: Upload,
      color: 'bg-blue-500',
      onClick: () => router.push('/sow/import'),
    },
    {
      title: 'View All SOWs',
      description: 'Browse all SOW documents',
      icon: FileSpreadsheet,
      color: 'bg-green-500',
      onClick: () => router.push('/sow/list'),
    },
    {
      title: 'Export Data',
      description: 'Export SOW data to Excel',
      icon: Download,
      color: 'bg-purple-500',
      onClick: () => router.push('/sow/export'),
    },
    {
      title: 'Search & Filter',
      description: 'Find specific SOW items',
      icon: Search,
      color: 'bg-orange-500',
      onClick: () => router.push('/sow/search'),
    },
    {
      title: 'Approvals',
      description: 'SOWs pending approval',
      icon: CheckCircle,
      color: 'bg-indigo-500',
      onClick: () => router.push('/sow/approvals'),
    },
    {
      title: 'Validation',
      description: 'Check SOW data integrity',
      icon: AlertCircle,
      color: 'bg-red-500',
      onClick: () => router.push('/sow/validation'),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">SOW Data Management</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Manage Scope of Work documents and data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div
            key={card.title}
            onClick={card.onClick}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md hover:border-[var(--ff-border-hover)] transition-all cursor-pointer"
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

      {/* Recent SOWs */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent SOW Documents</h2>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
          <div className="p-6">
            <p className="text-[var(--ff-text-secondary)] text-center">No recent SOW documents</p>
          </div>
        </div>
      </div>
    </div>
  );
}