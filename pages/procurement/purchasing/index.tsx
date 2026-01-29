/**
 * Purchasing Page - Unified tab interface for transaction workflow
 * Tabs: Requisitions | Quotes | Purchase Orders | GRN
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import { useTabPersistence } from '@/modules/procurement/hooks';
import {
  FileText,
  Scale,
  ClipboardList,
  ShoppingCart,
  PackageCheck,
  Plus,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Send,
  Package,
  Truck,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { log } from '@/lib/logger';

// Quote Evaluation Component
import QuoteEvaluationPage from '@/modules/procurement/quotes/QuoteEvaluationPage';

interface PurchasingPageProps {
  projectId?: string;
}

const TABS = [
  { id: 'requisitions', label: 'Requisitions', icon: ClipboardList },
  { id: 'quotes', label: 'Quotes', icon: Scale },
  { id: 'purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
  { id: 'grn', label: 'GRN', icon: PackageCheck },
] as const;

type TabId = typeof TABS[number]['id'];

// Types for Requisitions
type RequisitionStatus = 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'rejected' | 'ordered' | 'partially_ordered' | 'closed' | 'cancelled';

interface RequisitionListItem {
  id: string;
  requisitionNumber: string;
  status: RequisitionStatus;
  projectName?: string;
  requestedByName?: string;
  requiredDate?: string;
  estimatedTotal?: number;
  itemCount: number;
  createdAt: string;
}

// Types for Purchase Orders
type POStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'acknowledged' | 'partial_receipt' | 'completed' | 'cancelled';

interface POListItem {
  id: string;
  poNumber: string;
  status: POStatus;
  supplierName: string;
  projectName: string | null;
  total: number;
  itemCount: number;
  createdAt: string;
}

// Types for GRN
type GRNStatus = 'draft' | 'receiving' | 'inspecting' | 'completed' | 'partial' | 'rejected' | 'cancelled';

interface GRNListItem {
  id: string;
  grnNumber: string;
  status: GRNStatus;
  purchaseOrderNumber?: string;
  supplierName?: string;
  receivedDate?: string;
  itemCount: number;
}

const reqStatusConfig: Record<RequisitionStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-500/20 text-blue-400', icon: Clock },
  pending_approval: { label: 'Pending', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  ordered: { label: 'Ordered', color: 'bg-purple-500/20 text-purple-400', icon: CheckCircle },
  partially_ordered: { label: 'Partial', color: 'bg-indigo-500/20 text-indigo-400', icon: Clock },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300', icon: XCircle },
};

const poStatusConfig: Record<POStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  pending_approval: { label: 'Pending', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  sent: { label: 'Sent', color: 'bg-blue-500/20 text-blue-400', icon: Send },
  acknowledged: { label: 'Acknowledged', color: 'bg-indigo-500/20 text-indigo-400', icon: Package },
  partial_receipt: { label: 'Partial', color: 'bg-orange-500/20 text-orange-400', icon: Truck },
  completed: { label: 'Completed', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300', icon: XCircle },
};

const grnStatusConfig: Record<GRNStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  receiving: { label: 'Receiving', color: 'bg-blue-500/20 text-blue-400', icon: Package },
  inspecting: { label: 'Inspecting', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertCircle },
  completed: { label: 'Completed', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  partial: { label: 'Partial', color: 'bg-orange-500/20 text-orange-400', icon: Clock },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'bg-gray-500/20 text-gray-300', icon: XCircle },
};

// Helper functions
const formatCurrency = (value: number | undefined) => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

// Requisitions Tab Content
function RequisitionsTabContent() {
  const router = useRouter();
  const [requisitions, setRequisitions] = useState<RequisitionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchRequisitions();
  }, []);

  const fetchRequisitions = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/requisitions');
      const data = await response.json();
      if (data.success) {
        setRequisitions(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch requisitions', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = requisitions.filter(
    (r) =>
      r.requisitionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.projectName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search requisitions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/requisitions/new')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Requisition
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map((req) => {
          const status = reqStatusConfig[req.status];
          const StatusIcon = status.icon;
          return (
            <div
              key={req.id}
              onClick={() => router.push(`/procurement/requisitions/${req.id}`)}
              className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-blue-500/50 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">{req.requisitionNumber}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">{req.projectName || 'No project'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${status.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">{req.itemCount} items</span>
                  <span className="font-medium text-[var(--ff-text-primary)]">{formatCurrency(req.estimatedTotal)}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No requisitions found
          </div>
        )}
      </div>
    </div>
  );
}

// Purchase Orders Tab Content
function PurchaseOrdersTabContent() {
  const router = useRouter();
  const [orders, setOrders] = useState<POListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/purchase-orders');
      const data = await response.json();
      if (data.success) {
        setOrders(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch purchase orders', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = orders.filter(
    (po) =>
      po.poNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      po.supplierName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search purchase orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/purchase-orders/new')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New PO
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map((po) => {
          const status = poStatusConfig[po.status];
          const StatusIcon = status.icon;
          return (
            <div
              key={po.id}
              onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}
              className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-blue-500/50 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">{po.poNumber}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">{po.supplierName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${status.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">{po.itemCount} items</span>
                  <span className="font-medium text-[var(--ff-text-primary)]">{formatCurrency(po.total)}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No purchase orders found
          </div>
        )}
      </div>
    </div>
  );
}

// GRN Tab Content
function GRNTabContent() {
  const router = useRouter();
  const [grns, setGrns] = useState<GRNListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchGRNs();
  }, []);

  const fetchGRNs = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/grn');
      const data = await response.json();
      if (data.success) {
        setGrns(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch GRNs', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = grns.filter(
    (grn) =>
      grn.grnNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      grn.purchaseOrderNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search GRNs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={() => router.push('/procurement/grn/new')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New GRN
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map((grn) => {
          const status = grnStatusConfig[grn.status];
          const StatusIcon = status.icon;
          return (
            <div
              key={grn.id}
              onClick={() => router.push(`/procurement/grn/${grn.id}`)}
              className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-blue-500/50 cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PackageCheck className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">{grn.grnNumber}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">PO: {grn.purchaseOrderNumber || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${status.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                  <span className="text-sm text-[var(--ff-text-secondary)]">{grn.itemCount} items</span>
                  <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No goods receipt notes found
          </div>
        )}
      </div>
    </div>
  );
}

export default function PurchasingPage({ projectId }: PurchasingPageProps) {
  const { activeTab, changeTab, isInitialized } = useTabPersistence({
    pageKey: 'purchasing',
    defaultTab: 'requisitions',
    validTabs: TABS.map(t => t.id),
  });

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
            <ProcurementTabs activeTab="purchasing" categoriesOnly />
          </div>
        </div>

        {/* Sub-page Header with Sub-tabs */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-500" />
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Purchasing</h2>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="px-6">
            <nav className="flex gap-1" aria-label="Purchasing tabs">
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
                        ? 'border-green-500 text-green-600 dark:text-green-400'
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
            <div className="flex justify-center items-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-green-500" />
            </div>
          ) : (
            <>
              {activeTab === 'quotes' && <QuoteEvaluationPage />}
              {activeTab === 'requisitions' && <RequisitionsTabContent />}
              {activeTab === 'purchase-orders' && <PurchaseOrdersTabContent />}
              {activeTab === 'grn' && <GRNTabContent />}
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
