// WORKING: Purchase Orders list page
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  ShoppingCart,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  Send,
  Package,
  ChevronRight,
  Truck,
} from 'lucide-react';
import { log } from '@/lib/logger';

// Types
type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'acknowledged'
  | 'partial_receipt'
  | 'completed'
  | 'cancelled';

interface POListItem {
  id: string;
  poNumber: string;
  status: POStatus;
  supplierId: number;
  supplierName: string;
  projectName: string | null;
  deliveryDate: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  version: number;
  itemCount: number;
  createdByName: string;
  createdAt: string;
  odooPoId: number | null;
}

const statusConfig: Record<POStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  sent: { label: 'Sent', color: 'bg-blue-500/20 text-blue-400', icon: Send },
  acknowledged: { label: 'Acknowledged', color: 'bg-indigo-500/20 text-indigo-400', icon: Package },
  partial_receipt: { label: 'Partial Receipt', color: 'bg-orange-500/20 text-orange-400', icon: Truck },
  completed: { label: 'Completed', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300', icon: XCircle },
};

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [purchaseOrders, setPurchaseOrders] = useState<POListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');

  useEffect(() => {
    fetchPurchaseOrders();
  }, []);

  const fetchPurchaseOrders = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/purchase-orders');
      const data = await response.json();

      if (data.success) {
        setPurchaseOrders(data.data || []);
      } else {
        setError(data.error?.message || 'Failed to fetch purchase orders');
      }
    } catch (err) {
      log.error('Failed to fetch purchase orders', err);
      setError('Failed to load purchase orders');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredOrders = purchaseOrders.filter((po) => {
    const matchesSearch =
      po.poNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      po.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      po.projectName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(po.odooPoId || '').includes(searchTerm);

    const matchesStatus = statusFilter === 'all' || po.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  // Stats - show the 5 most relevant PO workflow statuses
  const stats = [
    { status: 'draft' as POStatus, label: 'Draft' },
    { status: 'pending_approval' as POStatus, label: 'Pending' },
    { status: 'approved' as POStatus, label: 'Approved' },
    { status: 'sent' as POStatus, label: 'Sent' },
    { status: 'completed' as POStatus, label: 'Completed' },
  ];

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <ShoppingCart className="h-6 w-6 text-blue-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    Purchase Orders
                  </h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Manage supplier purchase orders
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push('/procurement/purchase-orders/new')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Purchase Order
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="purchase-orders" categoriesOnly />
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search PO number, supplier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as POStatus | 'all')}
              className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="all">All Statuses</option>
              {Object.entries(statusConfig).map(([value, config]) => (
                <option key={value} value={value}>
                  {config.label}
                </option>
              ))}
            </select>
            <button className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors">
              <Filter className="h-4 w-4" />
              More Filters
            </button>
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-5 gap-4">
            {stats.map(({ status, label }) => {
              const config = statusConfig[status];
              const count = purchaseOrders.filter((po) => po.status === status).length;
              return (
                <div
                  key={status}
                  className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg cursor-pointer hover:border-blue-500/50 transition-colors"
                  onClick={() => setStatusFilter(status)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--ff-text-secondary)]">{label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${config.color}`}>
                      {count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-400">{error}</p>
              <button
                onClick={fetchPurchaseOrders}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No purchase orders found</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Create your first purchase order to get started
              </p>
            </div>
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      PO Number
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Project
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Delivery Date
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Total
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                      Items
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {filteredOrders.map((po) => {
                    const status = statusConfig[po.status];
                    const StatusIcon = status.icon;

                    return (
                      <tr
                        key={po.id}
                        onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}
                        className="hover:bg-[var(--ff-bg-hover)] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--ff-text-primary)]">
                              {po.poNumber}
                            </span>
                            {po.version > 1 && (
                              <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-medium rounded">
                                v{po.version}
                              </span>
                            )}
                            {po.odooPoId && (
                              <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                Odoo #{po.odooPoId}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {po.supplierName}
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {po.projectName || '-'}
                        </td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                          {formatDate(po.deliveryDate)}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--ff-text-primary)] font-medium">
                          {formatCurrency(po.total)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}
                            >
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </span>
                            {po.status === 'pending_approval' && (
                              <span className="animate-pulse w-2 h-2 bg-amber-400 rounded-full" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">
                          {po.itemCount}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
