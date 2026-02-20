/**
 * Field Stock Control Page
 * PRD-027: Main entry point for field stock management
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  FieldStockDashboard,
  LocationList,
  SerialScanner,
  PickingList,
  CreatePickingForm,
  ReturnList,
  CreateReturnModal,
  ContractorAccountabilityList,
} from '@/modules/procurement/field-stock/components';
import {
  useReturns,
  useContractorAccountability,
  useLocations,
  useStockItems,
  useConsumptions,
} from '@/modules/procurement/field-stock/hooks';
import {
  LayoutDashboard,
  MapPin,
  ScanLine,
  Package,
  ArrowRightLeft,
  RotateCcw,
  Users,
  Plus,
  Loader2,
  ShoppingCart,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import { FaultReportList } from '@/modules/procurement/field-stock/components/faults';
import { AdjustmentPanel } from '@/modules/procurement/field-stock/components/adjustments';

type TabType = 'dashboard' | 'locations' | 'serials' | 'consumptions' | 'pickings' | 'returns' | 'accountability' | 'faults' | 'adjustments';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const tabs: TabConfig[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
    description: 'Stock overview and key metrics'
  },
  {
    id: 'locations',
    label: 'Locations',
    icon: <MapPin className="h-5 w-5" />,
    description: 'Warehouses, sites, and technician stock'
  },
  {
    id: 'serials',
    label: 'Serials',
    icon: <ScanLine className="h-5 w-5" />,
    description: 'ONT, Router, and UPS serial tracking'
  },
  {
    id: 'consumptions',
    label: 'Consumptions',
    icon: <ArrowRightLeft className="h-5 w-5" />,
    description: 'Material usage linked to jobs'
  },
  {
    id: 'pickings',
    label: 'Transfers',
    icon: <Package className="h-5 w-5" />,
    description: 'Stock issues and transfers'
  },
  {
    id: 'returns',
    label: 'Returns',
    icon: <RotateCcw className="h-5 w-5" />,
    description: 'Return processing and inspection'
  },
  {
    id: 'accountability',
    label: 'Accountability',
    icon: <Users className="h-5 w-5" />,
    description: 'Contractor stock accountability'
  },
  {
    id: 'faults',
    label: 'Faults',
    icon: <AlertTriangle className="h-5 w-5" />,
    description: 'Equipment fault reports and analytics'
  },
  {
    id: 'adjustments',
    label: 'Adjustments',
    icon: <Settings className="h-5 w-5" />,
    description: 'Stock quantity adjustments'
  },
];

/** Transfers tab with list/create toggle */
function PickingsTab() {
  const [view, setView] = useState<'list' | 'create'>('list');
  if (view === 'create') {
    return <CreatePickingForm onSuccess={() => setView('list')} onCancel={() => setView('list')} />;
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setView('create')}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> New Transfer
        </button>
      </div>
      <PickingList />
    </div>
  );
}

/** Returns tab with create modal */
function ReturnsTabContent() {
  const { returns, loading, createReturn } = useReturns();
  const { locations } = useLocations({ autoFetch: true });
  const { items: stockItems } = useStockItems({ autoFetch: true });
  const [showCreate, setShowCreate] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          <Plus className="h-4 w-4" /> Create Return
        </button>
      </div>
      <ReturnList returns={returns} loading={loading} />
      <CreateReturnModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={async (data) => { await createReturn(data); setShowCreate(false); }}
        locations={locations}
        stockItems={stockItems}
      />
    </div>
  );
}

/** Accountability tab */
function AccountabilityTabContent() {
  const { contractors, loading } = useContractorAccountability({ autoFetch: true });
  return <ContractorAccountabilityList contractors={contractors} loading={loading} />;
}

/** Consumptions tab with recent list */
function ConsumptionsTabContent() {
  const router = useRouter();
  const { consumptions, loading } = useConsumptions({ autoFetch: true });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Recent Consumptions</h2>
        <button
          onClick={() => router.push('/projects/drops')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Record via Drops
        </button>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      ) : consumptions.length === 0 ? (
        <div className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-8 text-center">
          <p className="text-[var(--ff-text-secondary)]">No consumptions recorded yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Drop/Job</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Serial</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {consumptions.slice(0, 25).map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-[var(--ff-text-primary)]">{new Date(c.consumptionDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-mono text-[var(--ff-text-primary)]">{c.dropNumber || c.homeInstallId || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[var(--ff-text-primary)]">{c.serialNumber || '—'}</td>
                  <td className="px-4 py-3 text-[var(--ff-text-primary)]">{c.quantity}</td>
                  <td className="px-4 py-3 text-[var(--ff-text-primary)]">{c.consumedByName || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.verified ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'}`}>
                      {c.verified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FieldStockPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <FieldStockDashboard onNavigate={(tab) => setActiveTab(tab as TabType)} />;
      case 'locations':
        return <LocationList />;
      case 'serials':
        return (
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                Serial Number Lookup
              </h2>
              <SerialScanner
                onSerialSelected={(serial) => {
                  router.push(`/procurement/field-stock/serials/${serial.serialNumber}`);
                }}
                placeholder="Search by serial number, MAC address, or IMEI..."
              />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                Serial Registry
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Full serial number registry with filtering and export coming soon.
              </p>
            </div>
          </div>
        );
      case 'consumptions':
        return <ConsumptionsTabContent />;
      case 'pickings':
        return <PickingsTab />;
      case 'returns':
        return <ReturnsTabContent />;
      case 'accountability':
        return <AccountabilityTabContent />;
      case 'faults':
        return <FaultReportList />;
      case 'adjustments':
        return <AdjustmentPanel />;
      default:
        return <FieldStockDashboard onNavigate={(tab) => setActiveTab(tab as TabType)} />;
    }
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Module Header - Constant Position */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <ShoppingCart className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage procurement across all projects
                </p>
              </div>
            </div>
          </div>

          {/* Main Category Tab Navigation - Constant Position */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="field-stock" categoriesOnly />
          </div>
        </div>

        {/* Sub-page Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-blue-500" />
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Field Stock Control</h2>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="px-6">
            <nav className="-mb-px flex space-x-4 overflow-x-auto" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-4 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'
                  }`}
                  title={tab.description}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {renderTabContent()}
        </div>
      </div>
    </AppLayout>
  );
}
