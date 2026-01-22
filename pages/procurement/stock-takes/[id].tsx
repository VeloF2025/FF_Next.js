/**
 * Stock Take Detail Page
 * View, count, and manage a stock take
 * Following UI/UX Specification - Dark Theme
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ArrowLeft,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Box,
  Search,
  Filter,
  RefreshCw,
  Save,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { StockTake, StockTakeLine } from '@/types/procurement/stockTake.types';
import { STOCK_TAKE_STATUSES, LINE_STATUSES } from '@/types/procurement/stockTake.types';
import { notificationService } from '@/services/core/NotificationService';

export default function StockTakeDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [stockTake, setStockTake] = useState<StockTake | null>(null);
  const [lines, setLines] = useState<StockTakeLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showVarianceOnly, setShowVarianceOnly] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [countValue, setCountValue] = useState<string>('');

  const fetchStockTake = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/procurement/stock-takes/${id}`);
      const data = await res.json();

      if (data.success) {
        setStockTake(data.data);
        setLines(data.data.lines || []);
      } else {
        notificationService.error(data.error || 'Failed to load stock take');
        router.push('/procurement/stock-takes');
      }
    } catch (error) {
      console.error('Error fetching stock take:', error);
      notificationService.error('Failed to load stock take');
    } finally {
      setIsLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchStockTake();
  }, [fetchStockTake]);

  const handleAction = async (action: 'start' | 'complete' | 'approve' | 'cancel') => {
    if (!id) return;

    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/procurement/stock-takes/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success(data.message || `Stock take ${action}ed`);
        fetchStockTake();
      } else {
        notificationService.error(data.error || `Failed to ${action} stock take`);
      }
    } catch (error) {
      console.error(`Error ${action}ing stock take:`, error);
      notificationService.error(`Failed to ${action} stock take`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleInitialize = async () => {
    if (!id) return;

    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/procurement/stock-takes/${id}/lines`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success(data.message || 'Items initialized');
        fetchStockTake();
      } else {
        notificationService.error(data.error || 'Failed to initialize items');
      }
    } catch (error) {
      console.error('Error initializing items:', error);
      notificationService.error('Failed to initialize items');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSaveCount = async (lineId: string) => {
    if (!id || !countValue) return;

    try {
      const res = await fetch(`/api/procurement/stock-takes/${id}/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_id: lineId,
          counted_quantity: parseFloat(countValue),
        }),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Count recorded');
        setEditingLineId(null);
        setCountValue('');
        fetchStockTake();
      } else {
        notificationService.error(data.error || 'Failed to record count');
      }
    } catch (error) {
      console.error('Error recording count:', error);
      notificationService.error('Failed to record count');
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
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded ${colorMap[statusConfig?.color || 'gray']}`}>
        {statusConfig?.label || status}
      </span>
    );
  };

  const getLineStatusBadge = (status: string) => {
    const statusConfig = LINE_STATUSES.find(s => s.value === status);
    const colorMap: Record<string, string> = {
      gray: 'bg-gray-500/20 text-gray-400',
      blue: 'bg-blue-500/20 text-blue-400',
      purple: 'bg-purple-500/20 text-purple-400',
      green: 'bg-green-500/20 text-green-400',
      orange: 'bg-orange-500/20 text-orange-400',
    };
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${colorMap[statusConfig?.color || 'gray']}`}>
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

  // Filter lines
  const filteredLines = lines.filter(line => {
    if (search) {
      const searchLower = search.toLowerCase();
      if (!line.item_name?.toLowerCase().includes(searchLower) &&
          !line.item_code?.toLowerCase().includes(searchLower)) {
        return false;
      }
    }
    if (filterStatus && line.status !== filterStatus) return false;
    if (showVarianceOnly && line.variance_quantity === 0) return false;
    return true;
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </AppLayout>
    );
  }

  if (!stockTake) {
    return (
      <AppLayout>
        <div className="p-6 text-center text-gray-400">
          Stock take not found
        </div>
      </AppLayout>
    );
  }

  const canEdit = stockTake.status === 'in_progress';
  const isBlindCount = stockTake.count_method === 'blind' && canEdit;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <button
              onClick={() => router.push('/procurement/stock-takes')}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">{stockTake.name}</h1>
                {getStatusBadge(stockTake.status)}
              </div>
              <p className="text-gray-400 text-sm mt-1">{stockTake.reference_number}</p>
              {stockTake.description && (
                <p className="text-gray-500 text-sm mt-2">{stockTake.description}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {stockTake.status === 'draft' && lines.length === 0 && (
              <button
                onClick={handleInitialize}
                disabled={isActionLoading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Initialize Items
              </button>
            )}
            {stockTake.status === 'draft' && lines.length > 0 && (
              <button
                onClick={() => handleAction('start')}
                disabled={isActionLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start Counting
              </button>
            )}
            {stockTake.status === 'in_progress' && (
              <button
                onClick={() => handleAction('complete')}
                disabled={isActionLoading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Complete
              </button>
            )}
            {stockTake.status === 'pending_review' && (
              <button
                onClick={() => handleAction('approve')}
                disabled={isActionLoading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Approve
              </button>
            )}
            {stockTake.status !== 'approved' && stockTake.status !== 'cancelled' && (
              <button
                onClick={() => handleAction('cancel')}
                disabled={isActionLoading}
                className="px-4 py-2 border border-red-600 text-red-400 hover:bg-red-600/10 font-medium rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-[#1a1d23] rounded-lg p-4 border border-gray-700/50">
            <p className="text-gray-400 text-sm">Total Items</p>
            <p className="text-2xl font-semibold text-white">{stockTake.total_items || lines.length}</p>
          </div>
          <div className="bg-[#1a1d23] rounded-lg p-4 border border-gray-700/50">
            <p className="text-gray-400 text-sm">Counted</p>
            <p className="text-2xl font-semibold text-blue-400">
              {stockTake.counted_items || lines.filter(l => l.counted_quantity !== null).length}
            </p>
          </div>
          <div className="bg-[#1a1d23] rounded-lg p-4 border border-gray-700/50">
            <p className="text-gray-400 text-sm">With Variance</p>
            <p className="text-2xl font-semibold text-yellow-400">
              {stockTake.variance_items || lines.filter(l => l.variance_quantity !== 0).length}
            </p>
          </div>
          <div className="bg-[#1a1d23] rounded-lg p-4 border border-gray-700/50">
            <p className="text-gray-400 text-sm">Total Variance Value</p>
            <p className={`text-2xl font-semibold ${
              (stockTake.calc_variance_value || stockTake.total_variance_value || 0) !== 0 ? 'text-red-400' : 'text-green-400'
            }`}>
              {formatCurrency(Math.abs(stockTake.calc_variance_value || stockTake.total_variance_value || 0))}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-[#1a1d23] rounded-lg p-4 border border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Completion Progress</span>
            <span className="text-sm font-medium text-white">{stockTake.completion_percentage || 0}%</span>
          </div>
          <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${stockTake.completion_percentage || 0}%` }}
            />
          </div>
        </div>

        {/* Lines Table */}
        <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden">
          {/* Filters */}
          <div className="p-4 border-b border-gray-700 flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-gray-800/50 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:border-blue-500 outline-none"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 bg-gray-800/50 border border-gray-600 rounded-lg text-white text-sm focus:border-blue-500 outline-none"
            >
              <option value="">All Statuses</option>
              {LINE_STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showVarianceOnly}
                onChange={(e) => setShowVarianceOnly(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              Variance only
            </label>
          </div>

          {/* Table */}
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800/30 border-b border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Item</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">UOM</th>
                {!isBlindCount && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Expected</th>
                )}
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Counted</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Variance</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Status</th>
                {canEdit && <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredLines.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-gray-400">
                    <Box className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No items to display</p>
                    {stockTake.status === 'draft' && lines.length === 0 && (
                      <p className="text-sm mt-2">Click "Initialize Items" to populate the count sheet</p>
                    )}
                  </td>
                </tr>
              ) : (
                filteredLines.map((line) => (
                  <tr key={line.id} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{line.item_name}</p>
                      <p className="text-xs text-gray-500">{line.item_code}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-sm">{line.uom}</td>
                    {!isBlindCount && (
                      <td className="px-4 py-3 text-right text-gray-300">{line.expected_quantity}</td>
                    )}
                    <td className="px-4 py-3 text-right">
                      {editingLineId === line.id ? (
                        <input
                          type="number"
                          step="0.001"
                          value={countValue}
                          onChange={(e) => setCountValue(e.target.value)}
                          className="w-24 px-2 py-1 bg-gray-800 border border-blue-500 rounded text-white text-right text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveCount(line.id);
                            if (e.key === 'Escape') {
                              setEditingLineId(null);
                              setCountValue('');
                            }
                          }}
                        />
                      ) : (
                        <span className={line.counted_quantity !== null ? 'text-white' : 'text-gray-500'}>
                          {line.counted_quantity !== null ? line.counted_quantity : '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {line.variance_quantity !== 0 ? (
                        <span className={`font-medium ${line.variance_quantity > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {line.variance_quantity > 0 ? '+' : ''}{line.variance_quantity}
                        </span>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {getLineStatusBadge(line.status)}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-center">
                        {editingLineId === line.id ? (
                          <button
                            onClick={() => handleSaveCount(line.id)}
                            className="p-1.5 text-green-400 hover:bg-green-500/10 rounded"
                            title="Save"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingLineId(line.id);
                              setCountValue(line.counted_quantity?.toString() || '');
                            }}
                            className="px-3 py-1 text-sm text-blue-400 hover:bg-blue-500/10 rounded"
                          >
                            Count
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
