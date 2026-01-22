/**
 * Stock Takes Management Page
 * Physical inventory counting with variance tracking
 * Following UI/UX Specification - Dark Theme
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import {
  ClipboardCheck,
  Plus,
  Search,
  Eye,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  Filter,
  FileText,
  Box,
  TrendingDown,
} from 'lucide-react';
import type { StockTake } from '@/types/procurement/stockTake.types';
import { STOCK_TAKE_TYPES, STOCK_TAKE_STATUSES } from '@/types/procurement/stockTake.types';
import { notificationService } from '@/services/core/NotificationService';

export default function StockTakesPage() {
  const router = useRouter();
  const [stockTakes, setStockTakes] = useState<StockTake[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Stats
  const totalTakes = stockTakes.length;
  const inProgress = stockTakes.filter(st => st.status === 'in_progress').length;
  const pendingReview = stockTakes.filter(st => st.status === 'pending_review').length;
  const totalVariance = stockTakes.reduce((sum, st) => sum + Math.abs(st.calc_variance_value || st.total_variance_value || 0), 0);

  const fetchStockTakes = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('stock_take_type', filterType);

      const res = await fetch(`/api/procurement/stock-takes?${params}`);
      const data = await res.json();

      if (data.success) {
        setStockTakes(data.data);
      } else {
        notificationService.error(data.error || 'Failed to load stock takes');
      }
    } catch (error) {
      console.error('Error fetching stock takes:', error);
      notificationService.error('Failed to load stock takes');
    } finally {
      setIsLoading(false);
    }
  }, [search, filterStatus, filterType]);

  useEffect(() => {
    fetchStockTakes();
  }, [fetchStockTakes]);

  const handleCreate = async (formData: { name: string; description?: string; stock_take_type?: string; count_method?: string }) => {
    try {
      const res = await fetch('/api/procurement/stock-takes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Stock take created');
        setShowCreateModal(false);
        // Navigate to the detail page
        router.push(`/procurement/stock-takes/${data.data.id}`);
      } else {
        notificationService.error(data.error || 'Failed to create stock take');
      }
    } catch (error) {
      console.error('Error creating stock take:', error);
      notificationService.error('Failed to create stock take');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = STOCK_TAKE_STATUSES.find(s => s.value === status);
    const colorMap: Record<string, string> = {
      gray: 'bg-gray-500/20 text-gray-400',
      blue: 'bg-blue-500/20 text-blue-400',
      yellow: 'bg-yellow-500/20 text-yellow-400',
      green: 'bg-green-500/20 text-green-400',
      red: 'bg-red-500/20 text-red-400',
    };
    const colorClass = colorMap[statusConfig?.color || 'gray'];

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded ${colorClass}`}>
        {statusConfig?.label || status}
      </span>
    );
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
    }).format(value);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Stock Takes</h1>
            <p className="text-gray-400 text-sm mt-1">
              Physical inventory counts with variance tracking
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Stock Take
          </button>
        </div>

        {/* Stats */}
        <StatCardGrid columns={4}>
          <StatCard
            label="Total Stock Takes"
            value={totalTakes}
            icon={ClipboardCheck}
            colorType="total"
          />
          <StatCard
            label="In Progress"
            value={inProgress}
            icon={Play}
            colorType="info"
          />
          <StatCard
            label="Pending Review"
            value={pendingReview}
            icon={AlertTriangle}
            colorType="pending"
          />
          <StatCard
            label="Total Variance"
            value={formatCurrency(totalVariance)}
            icon={TrendingDown}
            colorType="error"
          />
        </StatCardGrid>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search stock takes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            <option value="">All Statuses</option>
            {STOCK_TAKE_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            <option value="">All Types</option>
            {STOCK_TAKE_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Stock Takes Table */}
        <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800/30 border-b border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Name</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Type</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Progress</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Variance</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Date</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : stockTakes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    <ClipboardCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No stock takes found</p>
                  </td>
                </tr>
              ) : (
                stockTakes.map((st) => (
                  <tr
                    key={st.id}
                    className="border-b border-gray-700/50 hover:bg-gray-800/30 cursor-pointer"
                    onClick={() => router.push(`/procurement/stock-takes/${st.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className="text-blue-400 font-mono text-sm">{st.reference_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{st.name}</p>
                      {st.description && (
                        <p className="text-xs text-gray-500 truncate max-w-xs">{st.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-gray-400">
                        {STOCK_TAKE_TYPES.find(t => t.value === st.stock_take_type)?.label || st.stock_take_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getStatusBadge(st.status)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all"
                            style={{ width: `${st.completion_percentage || 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">
                          {st.completion_percentage || 0}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(st.variance_count || 0) > 0 ? (
                        <span className={`text-sm font-medium ${
                          Math.abs(st.calc_variance_value || st.total_variance_value || 0) > 0
                            ? 'text-red-400'
                            : 'text-gray-400'
                        }`}>
                          {formatCurrency(Math.abs(st.calc_variance_value || st.total_variance_value || 0))}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-400">
                      {formatDate(st.scheduled_date || st.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => router.push(`/procurement/stock-takes/${st.id}`)}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateStockTakeModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
    </AppLayout>
  );
}

// Create Stock Take Modal
interface CreateModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; stock_take_type?: string; count_method?: string }) => void;
}

function CreateStockTakeModal({ onClose, onCreate }: CreateModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    stock_take_type: 'full',
    count_method: 'blind',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      notificationService.error('Name is required');
      return;
    }
    onCreate(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1e2128] rounded-xl border border-gray-700 shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">New Stock Take</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Q1 2026 Full Count"
              className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description..."
              rows={2}
              className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
              <select
                value={formData.stock_take_type}
                onChange={(e) => setFormData(prev => ({ ...prev, stock_take_type: e.target.value }))}
                className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                {STOCK_TAKE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Count Method</label>
              <select
                value={formData.count_method}
                onChange={(e) => setFormData(prev => ({ ...prev, count_method: e.target.value }))}
                className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="blind">Blind Count</option>
                <option value="guided">Guided Count</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              Create Stock Take
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
