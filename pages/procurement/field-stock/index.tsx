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
  ConsumptionRecorder
} from '@/modules/procurement/field-stock/components';
import {
  LayoutDashboard,
  MapPin,
  ScanLine,
  Package,
  ArrowRightLeft,
  RotateCcw,
  Users,
  FileText,
  ShoppingCart,
} from 'lucide-react';

type TabType = 'dashboard' | 'locations' | 'serials' | 'consumptions' | 'pickings' | 'returns' | 'accountability';

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
    label: 'Pickings',
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
];

export default function FieldStockPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <FieldStockDashboard />;
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
        return (
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                Record Consumption
              </h2>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                To record material consumption, navigate to a Drop or Home Install and use the
                "Record Materials" feature.
              </p>
              <button
                onClick={() => router.push('/projects/drops')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Go to Drops Management
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                Recent Consumptions
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Consumption history and verification workflow coming soon.
              </p>
            </div>
          </div>
        );
      case 'pickings':
        return (
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Stock Pickings
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Issue stock to technicians, process transfers, and manage allocations.
            </p>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => router.push('/procurement/field-stock/pickings/new?type=issue')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Issue Order
              </button>
              <button
                onClick={() => router.push('/procurement/field-stock/pickings/new?type=transfer')}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                Create Transfer
              </button>
            </div>
            <div className="mt-6">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Picking list, workflow, and signature capture coming in Phase 4.
              </p>
            </div>
          </div>
        );
      case 'returns':
        return (
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Stock Returns
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Process returns from field, inspect condition, and restock or dispose.
            </p>
            <button
              onClick={() => router.push('/procurement/field-stock/returns/new')}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Create Return Order
            </button>
            <div className="mt-6">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Return processing workflow coming in Phase 6.
              </p>
            </div>
          </div>
        );
      case 'accountability':
        return (
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Contractor Accountability
            </h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Track stock issued vs consumed vs returned per contractor. Identify unaccounted
              stock and manage liability.
            </p>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => router.push('/procurement/field-stock/accountability/report')}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
              >
                <FileText className="h-4 w-4" />
                Accountability Report
              </button>
              <button
                onClick={() => router.push('/procurement/field-stock/accountability/reconcile')}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                Run Reconciliation
              </button>
            </div>
            <div className="mt-6">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Full accountability module coming in Phase 7.
              </p>
            </div>
          </div>
        );
      default:
        return <FieldStockDashboard />;
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
            <ProcurementTabs activeTab="inventory" categoriesOnly />
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
