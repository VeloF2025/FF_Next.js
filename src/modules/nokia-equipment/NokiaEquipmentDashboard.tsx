import { Package, Wrench, BarChart3, Upload, Download, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NokiaEquipmentDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('inventory');

  const tabs = [
    { id: 'inventory', label: 'Inventory' },
    { id: 'installations', label: 'Installations' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'reports', label: 'Reports' },
  ];

  const cards = [
    {
      title: 'Equipment Catalog',
      description: 'Browse Nokia equipment catalog',
      icon: Package,
      color: 'bg-blue-500',
      onClick: () => router.push('/nokia-equipment/catalog'),
    },
    {
      title: 'Inventory Status',
      description: 'Current stock levels',
      icon: BarChart3,
      color: 'bg-green-500',
      stats: { total: 245, available: 180, deployed: 65 },
      onClick: () => router.push('/nokia-equipment/inventory'),
    },
    {
      title: 'Installations',
      description: 'Track equipment installations',
      icon: Wrench,
      color: 'bg-purple-500',
      onClick: () => router.push('/nokia-equipment/installations'),
    },
    {
      title: 'Maintenance',
      description: 'Schedule and track maintenance',
      icon: AlertTriangle,
      color: 'bg-orange-500',
      onClick: () => router.push('/nokia-equipment/maintenance'),
    },
    {
      title: 'Import Data',
      description: 'Import equipment data',
      icon: Upload,
      color: 'bg-indigo-500',
      onClick: () => router.push('/nokia-equipment/import'),
    },
    {
      title: 'Reports',
      description: 'Generate equipment reports',
      icon: Download,
      color: 'bg-pink-500',
      onClick: () => router.push('/nokia-equipment/reports'),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Nokia Equipment Data</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Manage Nokia network equipment inventory and installations</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--ff-border-light)] mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                py-2 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Navigation Cards */}
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
                <p className="text-sm text-[var(--ff-text-secondary)] mb-2">{card.description}</p>
                {card.stats && (
                  <div className="flex gap-4 text-xs">
                    <span className="text-[var(--ff-text-secondary)]">
                      Total: <span className="font-semibold">{card.stats.total}</span>
                    </span>
                    <span className="text-green-600">
                      Available: <span className="font-semibold">{card.stats.available}</span>
                    </span>
                    <span className="text-blue-600">
                      Deployed: <span className="font-semibold">{card.stats.deployed}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Equipment Summary */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Equipment Summary</h2>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
          <div className="p-6">
            <p className="text-[var(--ff-text-secondary)] text-center">No equipment data available</p>
          </div>
        </div>
      </div>
    </div>
  );
}