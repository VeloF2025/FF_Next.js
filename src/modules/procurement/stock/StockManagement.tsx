/**
 * Stock Management Module - Main Tab Component
 * Comprehensive inventory management with dashboard, operations, and warehouse management
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  Package,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Truck,
  Scan,
  Search,
  Filter,
  ArrowRight,
  ArrowLeft,
  Plus,
  RefreshCw,
  Eye,
  Tag,
  MapPin,
  Calendar,
  User,
  FileText,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { log } from '@/lib/logger';

// Types
interface StockItemDisplay {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number;
  unitCost: number;
  totalValue: number;
  warehouse: string;
  location: string;
  supplier: string;
  lastRestocked: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
}

interface StockMovementDisplay {
  id: string;
  type: 'GRN' | 'ISSUE' | 'TRANSFER' | 'ADJUSTMENT';
  reference_number: string;
  item_code?: string;
  item_name?: string;
  quantity?: number;
  uom?: string;
  from_location?: string;
  to_location?: string;
  movement_date: string;
  status: string;
  requested_by?: string;
  notes?: string;
}

interface StockMetrics {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  pendingReceipts: number;
  pendingIssues: number;
  stockTurnover: number;
  warehouseUtilization: number;
}

interface StockManagementProps {
  projectId?: string;
  projectName?: string;
}

type FilterStatus = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
type SortBy = 'name' | 'itemCode' | 'quantity' | 'value' | 'lastRestocked';
type ActiveTab = 'inventory' | 'movements';

export default function StockManagement({ projectId, projectName }: StockManagementProps) {
  const router = useRouter();

  // State
  const [activeTab, setActiveTab] = useState<ActiveTab>('inventory');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<StockItemDisplay[]>([]);
  const [movements, setMovements] = useState<StockMovementDisplay[]>([]);
  const [metrics, setMetrics] = useState<StockMetrics>({
    totalItems: 0,
    totalValue: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    pendingReceipts: 0,
    pendingIssues: 0,
    stockTurnover: 0,
    warehouseUtilization: 0
  });

  // Filter/Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Load stock data from API
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const url = projectId && projectId !== 'all'
        ? `/api/procurement/stock?projectId=${projectId}`
        : '/api/procurement/stock';

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch stock data');
      }
      const data = await response.json();

      // Transform items to display format
      const stockItems: StockItemDisplay[] = (data.items || []).map((item: any) => ({
        id: item.id,
        itemCode: item.itemCode || 'N/A',
        name: item.name || item.itemName || 'Unnamed Item',
        description: item.description || '',
        category: item.category || 'General',
        unit: item.unit || 'EA',
        quantity: Number(item.quantity || 0),
        minQuantity: Number(item.minQuantity || 0),
        maxQuantity: Number(item.maxQuantity || 0),
        unitCost: Number(item.unitCost || 0),
        totalValue: Number(item.totalValue || 0),
        warehouse: item.warehouse || 'Main Warehouse',
        location: item.location || '',
        supplier: item.supplier || 'Unknown',
        lastRestocked: item.lastRestocked || '',
        status: item.status || determineStatus(item)
      }));

      setItems(stockItems);
      setMovements(data.movements || []);

      // Calculate metrics
      const lowStock = stockItems.filter(item => item.status === 'low_stock').length;
      const outOfStock = stockItems.filter(item => item.status === 'out_of_stock').length;
      const totalValue = stockItems.reduce((sum, item) => sum + (item.totalValue || 0), 0);

      setMetrics({
        totalItems: stockItems.length,
        totalValue,
        lowStockItems: lowStock,
        outOfStockItems: outOfStock,
        pendingReceipts: 0,
        pendingIssues: 0,
        stockTurnover: 0,
        warehouseUtilization: 0
      });

    } catch (err) {
      log.error('Failed to load stock data:', { data: err }, 'StockManagement');
      setError('Failed to load stock data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Helper to determine status from quantity
  function determineStatus(item: any): 'in_stock' | 'low_stock' | 'out_of_stock' {
    const qty = Number(item.quantity || 0);
    const minQty = Number(item.minQuantity || item.reorderLevel || 10);
    if (qty <= 0) return 'out_of_stock';
    if (qty <= minQty) return 'low_stock';
    return 'in_stock';
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for refresh events
  useEffect(() => {
    const handleRefresh = () => loadData();
    window.addEventListener('stockDataRefresh', handleRefresh);
    return () => window.removeEventListener('stockDataRefresh', handleRefresh);
  }, [loadData]);

  // Filter and sort items
  const filteredItems = items
    .filter(item => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch =
          item.name.toLowerCase().includes(search) ||
          item.itemCode.toLowerCase().includes(search) ||
          item.category.toLowerCase().includes(search) ||
          item.description.toLowerCase().includes(search);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (filterStatus !== 'all' && item.status !== filterStatus) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'itemCode':
          return a.itemCode.localeCompare(b.itemCode);
        case 'quantity':
          return b.quantity - a.quantity;
        case 'value':
          return b.totalValue - a.totalValue;
        case 'lastRestocked':
          return new Date(b.lastRestocked).getTime() - new Date(a.lastRestocked).getTime();
        case 'name':
        default:
          return a.name.localeCompare(b.name);
      }
    });

  // Handle item selection
  const toggleItemSelect = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  };

  // Status badge component
  const StatusBadge = ({ status }: { status: StockItemDisplay['status'] }) => {
    const config = {
      'in_stock': { bg: 'bg-green-500/20', text: 'text-green-400', icon: CheckCircle, label: 'In Stock' },
      'low_stock': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: AlertTriangle, label: 'Low Stock' },
      'out_of_stock': { bg: 'bg-red-500/20', text: 'text-red-400', icon: XCircle, label: 'Out of Stock' }
    };
    const { bg, text, icon: Icon, label } = config[status] || config['in_stock'];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  };

  // Movement type badge
  const MovementTypeBadge = ({ type }: { type: string }) => {
    const config: Record<string, { bg: string; text: string; icon: React.ElementType; label: string }> = {
      'GRN': { bg: 'bg-green-500/20', text: 'text-green-400', icon: Package, label: 'Receipt' },
      'ISSUE': { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: ArrowRight, label: 'Issue' },
      'TRANSFER': { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: ArrowLeft, label: 'Transfer' },
      'ADJUSTMENT': { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: FileText, label: 'Adjustment' }
    };
    const defaultConfig = { bg: 'bg-green-500/20', text: 'text-green-400', icon: Package, label: 'Receipt' };
    const { bg, text, icon: Icon, label } = config[type] ?? defaultConfig;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Stock Management</h1>
          {projectName && (
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Comprehensive inventory control for {projectName}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {/* TODO: Barcode scanning */}}
            className="hidden sm:flex"
          >
            <Scan className="h-4 w-4 mr-2" />
            Scan Barcode
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push('/procurement/inventory?tab=reports')}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Reports
          </Button>

          <Button
            variant="outline"
            onClick={loadData}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {(metrics.lowStockItems > 0 || metrics.outOfStockItems > 0) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-red-400">Stock Level Alerts</h3>
              <p className="text-sm text-red-300 mt-1">
                {metrics.outOfStockItems > 0 &&
                  `${metrics.outOfStockItems} item${metrics.outOfStockItems !== 1 ? 's' : ''} out of stock. `
                }
                {metrics.lowStockItems > 0 &&
                  `${metrics.lowStockItems} item${metrics.lowStockItems !== 1 ? 's' : ''} below minimum level. `
                }
                Immediate action required to prevent project delays.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setFilterStatus('low_stock')}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              View Low Stock
            </Button>
          </div>
        </div>
      )}

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <div className="flex items-center">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Package className="h-5 w-5 text-blue-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Items</p>
              <p className="text-xl font-bold text-[var(--ff-text-primary)]">{metrics.totalItems.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <div className="flex items-center">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Value</p>
              <p className="text-xl font-bold text-green-400">
                R {(metrics.totalValue / 1000).toFixed(0)}k
              </p>
            </div>
          </div>
        </div>

        <div
          className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 cursor-pointer hover:border-yellow-500/50 transition-colors"
          onClick={() => setFilterStatus('low_stock')}
        >
          <div className="flex items-center">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-[var(--ff-text-secondary)]">Low Stock</p>
              <p className="text-xl font-bold text-yellow-400">{metrics.lowStockItems}</p>
            </div>
          </div>
        </div>

        <div
          className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4 cursor-pointer hover:border-red-500/50 transition-colors"
          onClick={() => setFilterStatus('out_of_stock')}
        >
          <div className="flex items-center">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <XCircle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-[var(--ff-text-secondary)]">Out of Stock</p>
              <p className="text-xl font-bold text-red-400">{metrics.outOfStockItems}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-[var(--ff-border-light)]">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'inventory'
              ? 'border-[var(--ff-primary-500)] text-[var(--ff-primary-400)]'
              : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
          }`}
        >
          <Package className="h-4 w-4 inline-block mr-2" />
          Inventory ({filteredItems.length})
        </button>
        <button
          onClick={() => setActiveTab('movements')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'movements'
              ? 'border-[var(--ff-primary-500)] text-[var(--ff-primary-400)]'
              : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
          }`}
        >
          <Truck className="h-4 w-4 inline-block mr-2" />
          Movements ({movements.length})
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-[var(--ff-primary-500)]" />
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
          <p className="text-red-400">{error}</p>
          <Button variant="outline" onClick={loadData} className="mt-2">
            Try Again
          </Button>
        </div>
      )}

      {/* Inventory Tab */}
      {!isLoading && !error && activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md px-3 py-1.5 text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] w-64 focus:outline-none focus:border-[var(--ff-primary-500)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                  className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md px-3 py-1.5 text-sm text-[var(--ff-text-primary)]"
                >
                  <option value="all">All Status</option>
                  <option value="in_stock">In Stock</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--ff-text-tertiary)]">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md px-3 py-1.5 text-sm text-[var(--ff-text-primary)]"
                >
                  <option value="name">Name</option>
                  <option value="itemCode">Item Code</option>
                  <option value="quantity">Quantity</option>
                  <option value="value">Value</option>
                  <option value="lastRestocked">Last Restocked</option>
                </select>
              </div>
            </div>

            {selectedItems.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--ff-text-secondary)]">{selectedItems.size} selected</span>
                <Button variant="outline" size="sm">
                  <ArrowRight className="h-4 w-4 mr-1" />
                  Issue
                </Button>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Transfer
                </Button>
              </div>
            )}
          </div>

          {/* Stock Items List */}
          {filteredItems.length === 0 ? (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-12 text-center">
              <Package className="mx-auto h-12 w-12 text-[var(--ff-text-tertiary)]" />
              <h3 className="mt-4 text-lg font-medium text-[var(--ff-text-primary)]">No Stock Items Found</h3>
              <p className="mt-2 text-[var(--ff-text-secondary)]">
                {searchTerm || filterStatus !== 'all'
                  ? 'Try adjusting your search or filter criteria.'
                  : 'No stock items have been added yet.'}
              </p>
              {filterStatus !== 'all' && (
                <Button variant="outline" onClick={() => setFilterStatus('all')} className="mt-4">
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                <div className="flex items-center gap-4">
                  <input
                    type="checkbox"
                    checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                    onChange={selectAll}
                    className="h-4 w-4 rounded border-[var(--ff-border-light)]"
                  />
                  <span className="text-sm font-medium text-[var(--ff-text-secondary)]">
                    {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Items */}
              <div className="divide-y divide-[var(--ff-border-light)]">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 hover:bg-[var(--ff-bg-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.id)}
                        onChange={() => toggleItemSelect(item.id)}
                        className="mt-1 h-4 w-4 rounded border-[var(--ff-border-light)]"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-[var(--ff-text-primary)]">{item.name}</h3>
                          <span className="text-sm text-[var(--ff-text-tertiary)]">{item.itemCode}</span>
                          <StatusBadge status={item.status} />
                        </div>

                        {item.description && (
                          <p className="text-sm text-[var(--ff-text-secondary)] mb-2">{item.description}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--ff-text-tertiary)]">
                          <span className="flex items-center gap-1">
                            <Tag className="h-4 w-4" />
                            {item.category}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {item.warehouse}
                          </span>
                          {item.supplier && item.supplier !== 'Unknown' && (
                            <span className="flex items-center gap-1">
                              <Truck className="h-4 w-4" />
                              {item.supplier}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quantities */}
                      <div className="grid grid-cols-3 gap-4 text-right">
                        <div>
                          <p className="text-xs text-[var(--ff-text-tertiary)]">Current</p>
                          <p className={`font-semibold ${
                            item.status === 'out_of_stock' ? 'text-red-400' :
                            item.status === 'low_stock' ? 'text-yellow-400' :
                            'text-[var(--ff-text-primary)]'
                          }`}>
                            {item.quantity.toLocaleString()} {item.unit}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ff-text-tertiary)]">Min</p>
                          <p className="font-semibold text-[var(--ff-text-secondary)]">
                            {item.minQuantity.toLocaleString()} {item.unit}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[var(--ff-text-tertiary)]">Value</p>
                          <p className="font-semibold text-green-400">
                            R {item.totalValue.toLocaleString()}
                          </p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Stock Level Bar */}
                    <div className="mt-3 ml-8">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                          {item.maxQuantity > 0 ? (
                            <div
                              className={`h-full rounded-full ${
                                item.status === 'out_of_stock' ? 'bg-red-500' :
                                item.status === 'low_stock' ? 'bg-yellow-500' :
                                'bg-green-500'
                              }`}
                              style={{
                                width: `${Math.min(100, (item.quantity / item.maxQuantity) * 100)}%`
                              }}
                            />
                          ) : (
                            <div
                              className={`h-full rounded-full ${
                                item.quantity > 0 ? 'bg-green-500' : 'bg-red-500'
                              }`}
                              style={{ width: item.quantity > 0 ? '50%' : '0%' }}
                            />
                          )}
                        </div>
                        <span className="text-xs text-[var(--ff-text-tertiary)] w-16 text-right">
                          {item.maxQuantity > 0
                            ? `${Math.round((item.quantity / item.maxQuantity) * 100)}%`
                            : item.quantity > 0 ? 'OK' : 'Empty'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Movements Tab */}
      {!isLoading && !error && activeTab === 'movements' && (
        <div className="space-y-4">
          {movements.length === 0 ? (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-12 text-center">
              <Truck className="mx-auto h-12 w-12 text-[var(--ff-text-tertiary)]" />
              <h3 className="mt-4 text-lg font-medium text-[var(--ff-text-primary)]">No Stock Movements</h3>
              <p className="mt-2 text-[var(--ff-text-secondary)]">
                No stock movements have been recorded yet.
              </p>
            </div>
          ) : (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
              <div className="divide-y divide-[var(--ff-border-light)]">
                {movements.map((movement) => (
                  <div
                    key={movement.id}
                    className="p-4 hover:bg-[var(--ff-bg-hover)] transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-semibold text-[var(--ff-text-primary)]">
                            {movement.reference_number}
                          </h4>
                          <MovementTypeBadge type={movement.type || 'GRN'} />
                        </div>

                        {movement.item_name && (
                          <p className="text-sm text-[var(--ff-text-secondary)] mb-2">
                            {movement.item_code && `${movement.item_code} - `}{movement.item_name}
                            {movement.quantity && ` (${movement.quantity} ${movement.uom || 'EA'})`}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--ff-text-tertiary)]">
                          {movement.from_location && (
                            <span>From: {movement.from_location}</span>
                          )}
                          {movement.to_location && (
                            <span>To: {movement.to_location}</span>
                          )}
                          {movement.requested_by && (
                            <span className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              {movement.requested_by}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(movement.movement_date)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          movement.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          movement.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                          movement.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {movement.status}
                        </span>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
