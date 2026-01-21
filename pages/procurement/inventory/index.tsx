/**
 * Inventory Page - Unified tab interface for stock management
 * Tabs: Stock | Items | Categories | Bundles | Takes | Field
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import { useTabPersistence } from '@/modules/procurement/hooks';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import {
  Warehouse,
  ArrowLeftRight,
  Boxes,
  FolderTree,
  PackagePlus,
  ClipboardCheck,
  Package,
  Plus,
  Search,
  Loader2,
  Eye,
  Edit2,
  Trash2,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Box,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';

// Import existing components
import { StockItemsPage } from '@/modules/stock-items';
import StockManagement from '@/modules/procurement/stock/StockManagement';
import {
  FieldStockDashboard,
  LocationList,
  SerialScanner,
  ConsumptionRecorder,
} from '@/modules/procurement/field-stock/components';

interface InventoryPageProps {
  projectId?: string;
}

const TABS = [
  { id: 'stock', label: 'Stock', icon: ArrowLeftRight },
  { id: 'items', label: 'Items', icon: Boxes },
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'bundles', label: 'Bundles', icon: PackagePlus },
  { id: 'takes', label: 'Takes', icon: ClipboardCheck },
  { id: 'field', label: 'Field', icon: Package },
] as const;

type TabId = typeof TABS[number]['id'];

// Loading component
function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      <span className="ml-2 text-[var(--ff-text-secondary)]">{message}</span>
    </div>
  );
}

// Types for Stock Categories
interface StockCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  parent_id?: string;
  is_active: boolean;
  item_count?: number;
}

// Types for Bundles
interface StockBundle {
  id: string;
  name: string;
  code: string;
  description?: string;
  bundle_type: string;
  is_active: boolean;
  item_count?: number;
  total_cost?: number;
}

// Types for Stock Takes
interface StockTake {
  id: string;
  reference_number: string;
  status: 'draft' | 'in_progress' | 'pending_review' | 'completed' | 'cancelled';
  stock_take_type: string;
  started_at?: string;
  completed_at?: string;
  item_count?: number;
  calc_variance_value?: number;
  total_variance_value?: number;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  pending_review: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-300',
};

// Categories Tab Content
function CategoriesTabContent() {
  const router = useRouter();
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/categories');
      const data = await res.json();
      if (data.success) {
        setCategories(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch categories', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  );

  const totalCategories = categories.length;
  const activeCategories = categories.filter(c => c.is_active).length;
  const totalItems = categories.reduce((sum, c) => sum + (c.item_count || 0), 0);

  if (isLoading) return <LoadingState message="Loading categories..." />;

  return (
    <div className="space-y-6">
      <StatCardGrid columns={3}>
        <StatCard
          label="Total Categories"
          value={totalCategories}
          icon={FolderTree}
          colorType="blue"
        />
        <StatCard
          label="Active"
          value={activeCategories}
          icon={FolderTree}
          colorType="green"
        />
        <StatCard
          label="Total Items"
          value={totalItems}
          icon={Box}
          colorType="purple"
        />
      </StatCardGrid>

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/stock-categories?action=new')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Category
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((cat) => (
          <div
            key={cat.id}
            className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg hover:border-indigo-500/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderTree className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{cat.name}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{cat.code}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs ${cat.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {cat.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-sm text-[var(--ff-text-secondary)]">{cat.item_count || 0} items</span>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No categories found
          </div>
        )}
      </div>
    </div>
  );
}

// Bundles Tab Content
function BundlesTabContent() {
  const router = useRouter();
  const [bundles, setBundles] = useState<StockBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchBundles();
  }, []);

  const fetchBundles = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/bundles');
      const data = await res.json();
      if (data.success) {
        setBundles(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch bundles', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = bundles.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase())
  );

  const totalBundles = bundles.length;
  const activeBundles = bundles.filter(b => b.is_active).length;
  const totalValue = bundles.reduce((sum, b) => sum + (b.total_cost || 0), 0);

  if (isLoading) return <LoadingState message="Loading bundles..." />;

  return (
    <div className="space-y-6">
      <StatCardGrid columns={3}>
        <StatCard
          label="Total Bundles"
          value={totalBundles}
          icon={PackagePlus}
          colorType="blue"
        />
        <StatCard
          label="Active"
          value={activeBundles}
          icon={PackagePlus}
          colorType="green"
        />
        <StatCard
          label="Total Value"
          value={`R ${totalValue.toLocaleString()}`}
          icon={DollarSign}
          colorType="purple"
        />
      </StatCardGrid>

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search bundles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/bundles?action=new')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Bundle
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((bundle) => (
          <div
            key={bundle.id}
            className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg hover:border-indigo-500/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PackagePlus className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{bundle.name}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{bundle.code} • {bundle.bundle_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs ${bundle.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {bundle.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-sm text-[var(--ff-text-secondary)]">{bundle.item_count || 0} items</span>
                <span className="font-medium text-[var(--ff-text-primary)]">R {(bundle.total_cost || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No bundles found
          </div>
        )}
      </div>
    </div>
  );
}

// Stock Takes Tab Content
function StockTakesTabContent() {
  const router = useRouter();
  const [stockTakes, setStockTakes] = useState<StockTake[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchStockTakes();
  }, []);

  const fetchStockTakes = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/stock-takes');
      const data = await res.json();
      if (data.success) {
        setStockTakes(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch stock takes', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = stockTakes.filter(
    (st) => st.reference_number.toLowerCase().includes(search.toLowerCase())
  );

  const totalTakes = stockTakes.length;
  const inProgress = stockTakes.filter(st => st.status === 'in_progress').length;
  const totalVariance = stockTakes.reduce((sum, st) => sum + Math.abs(st.calc_variance_value || st.total_variance_value || 0), 0);

  if (isLoading) return <LoadingState message="Loading stock takes..." />;

  return (
    <div className="space-y-6">
      <StatCardGrid columns={3}>
        <StatCard
          label="Total Takes"
          value={totalTakes}
          icon={ClipboardCheck}
          colorType="blue"
        />
        <StatCard
          label="In Progress"
          value={inProgress}
          icon={ClipboardCheck}
          colorType="yellow"
        />
        <StatCard
          label="Total Variance"
          value={`R ${totalVariance.toLocaleString()}`}
          icon={AlertTriangle}
          colorType="red"
        />
      </StatCardGrid>

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search stock takes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/stock-takes?action=new')}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Stock Take
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((take) => (
          <div
            key={take.id}
            onClick={() => router.push(`/procurement/stock-takes/${take.id}`)}
            className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg hover:border-indigo-500/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{take.reference_number}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{take.stock_take_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs ${statusColors[take.status] || 'bg-gray-500/20 text-gray-400'}`}>
                  {take.status.replace('_', ' ')}
                </span>
                <span className="text-sm text-[var(--ff-text-secondary)]">{take.item_count || 0} items</span>
                <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No stock takes found
          </div>
        )}
      </div>
    </div>
  );
}

export default function InventoryPage({ projectId }: InventoryPageProps) {
  const { activeTab, changeTab, isInitialized } = useTabPersistence({
    pageKey: 'inventory',
    defaultTab: 'stock',
    validTabs: TABS.map(t => t.id),
  });

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Page Header */}
        <div className="border-b border-[var(--ff-border-primary)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10">
                <Warehouse className="h-6 w-6 text-indigo-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  Inventory
                </h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage stock, items, categories, bundles, and field inventory
                </p>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="px-6">
            <nav className="flex gap-1" aria-label="Inventory tabs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => changeTab(tab.id)}
                    className={`
                      flex items-center gap-2 px-4 py-3 text-sm font-medium
                      border-b-2 transition-colors
                      ${isActive
                        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-secondary)]'
                      }
                    `}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {!isInitialized ? (
            <LoadingState message="Loading..." />
          ) : (
            <>
              {activeTab === 'stock' && <StockManagement />}
              {activeTab === 'items' && <StockItemsPage />}
              {activeTab === 'categories' && <CategoriesTabContent />}
              {activeTab === 'bundles' && <BundlesTabContent />}
              {activeTab === 'takes' && <StockTakesTabContent />}
              {activeTab === 'field' && <FieldStockDashboard />}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;

  return {
    props: {
      projectId: projectId || null,
    },
  };
};
