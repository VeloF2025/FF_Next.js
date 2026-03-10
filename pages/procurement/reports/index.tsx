/**
 * Procurement Reports Page
 * Comprehensive reporting for procurement operations
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Package,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Truck,
  FileText,
  Download,
  Calendar,
  Filter,
  RefreshCw,
  ChevronRight,
  Star,
  Target,
  Loader2,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { BOQSpendSummary } from '@/modules/procurement/reports/BOQSpendSummary';

// Report period options
const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year', label: 'This Year' },
  { id: 'custom', label: 'Custom Range' },
] as const;

type PeriodId = typeof PERIODS[number]['id'];

// Report types
const REPORT_SECTIONS = [
  {
    id: 'supplier-performance',
    title: 'Supplier Performance',
    description: 'OTIF rates, quality scores, and delivery metrics',
    icon: Users,
    color: 'blue',
  },
  {
    id: 'spend-analysis',
    title: 'Spend Analysis',
    description: 'Spending by category, supplier, and project',
    icon: DollarSign,
    color: 'green',
  },
  {
    id: 'inventory-health',
    title: 'Inventory Health',
    description: 'Stock levels, alerts, and turnover rates',
    icon: Package,
    color: 'orange',
  },
  {
    id: 'cycle-time',
    title: 'Cycle Time Analysis',
    description: 'Procurement process efficiency metrics',
    icon: Clock,
    color: 'purple',
  },
] as const;

// Interfaces
interface SupplierMetrics {
  supplierId: string;
  supplierName: string;
  otifRate: number;
  qualityScore: number;
  deliveryRate: number;
  avgLeadTime: number;
  totalOrders: number;
  totalValue: number;
}

interface SpendCategory {
  category: string;
  amount: number;
  percentage: number;
  change: number;
  itemCount: number;
}

interface InventoryAlert {
  itemId: string;
  itemName: string;
  currentQty: number;
  minLevel: number;
  maxLevel: number;
  status: 'critical' | 'low' | 'excess' | 'normal';
  category: string;
}

interface CycleMetric {
  stage: string;
  avgDays: number;
  minDays: number;
  maxDays: number;
  trend: 'up' | 'down' | 'stable';
}

interface ReportData {
  supplierMetrics: SupplierMetrics[];
  spendByCategory: SpendCategory[];
  inventoryAlerts: InventoryAlert[];
  cycleMetrics: CycleMetric[];
  summary: {
    totalSpend: number;
    avgOtif: number;
    stockAlerts: number;
    avgCycleTime: number;
  };
}

export default function ProcurementReportsPage() {
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodId>('month');
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<ReportData | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    fetchReportData();
  }, [selectedPeriod]);

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      const [metricsRes, stockRes, suppliersRes, reportsRes] = await Promise.all([
        fetch('/api/procurement/metrics/aggregate'),
        fetch('/api/procurement/stock?status=low_stock'),
        fetch('/api/suppliers'),
        fetch('/api/procurement/reports-data'),
      ]);

      const metrics = await metricsRes.json();
      const stockData = await stockRes.json();
      const suppliersData = await suppliersRes.json();
      const reportsData = await reportsRes.json();

      const supplierList = suppliersData?.data || suppliersData || [];
      const reports = reportsData?.data || {};

      setData({
        supplierMetrics: formatSupplierMetrics(supplierList),
        spendByCategory: formatSpendCategories(reports.spendByCategory || []),
        inventoryAlerts: formatStockAlerts(stockData?.data || stockData?.items || []),
        cycleMetrics: formatCycleMetrics(reports.cycleMetrics || []),
        summary: {
          totalSpend: metrics?.data?.totalBOQValue || 0,
          avgOtif: calculateAvgOtif(supplierList),
          stockAlerts: (stockData?.data || stockData?.items || []).length,
          avgCycleTime: reports.avgTotalCycleDays || Number(metrics?.data?.averageCycleDays) || 0,
        },
      });
    } catch (error) {
      log.error('Failed to fetch report data', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Format real supplier data from /api/suppliers
  const formatSupplierMetrics = (suppliers: any[]): SupplierMetrics[] => {
    return suppliers
      .filter((s: any) => s.status === 'ACTIVE')
      .map((s: any) => {
        const rating = typeof s.rating === 'object' ? s.rating : null;
        const overall = rating?.overall ?? (typeof s.ratingOverall === 'number' ? s.ratingOverall : 0);
        const delivery = rating?.delivery ?? (typeof s.ratingDelivery === 'number' ? s.ratingDelivery : 0);
        return {
          supplierId: s.id,
          supplierName: s.name,
          otifRate: delivery > 0 ? Math.round(delivery * 20) : 0,
          qualityScore: overall > 0 ? Number(overall.toFixed(1)) : 0,
          deliveryRate: delivery > 0 ? Math.round(delivery * 20) : 0,
          avgLeadTime: s.leadTimeDays || s.lead_time_days || 0,
          totalOrders: s.totalOrders || s.total_orders || 0,
          totalValue: s.totalValue || s.total_value || 0,
        };
      })
      .sort((a: SupplierMetrics, b: SupplierMetrics) => b.qualityScore - a.qualityScore);
  };

  // Calculate real average OTIF from supplier data
  const calculateAvgOtif = (suppliers: any[]): number => {
    const active = suppliers.filter((s: any) => s.status === 'ACTIVE');
    if (active.length === 0) return 0;
    const totalDelivery = active.reduce((sum: number, s: any) => {
      const rating = typeof s.rating === 'object' ? s.rating : null;
      const delivery = rating?.delivery ?? (typeof s.ratingDelivery === 'number' ? s.ratingDelivery : 0);
      return sum + (delivery > 0 ? delivery * 20 : 0);
    }, 0);
    const rated = active.filter((s: any) => {
      const rating = typeof s.rating === 'object' ? s.rating : null;
      const delivery = rating?.delivery ?? s.ratingDelivery ?? 0;
      return delivery > 0;
    });
    return rated.length > 0 ? Math.round(totalDelivery / rated.length) : 0;
  };

  // Format spend categories from real BOQ item data grouped by category
  const formatSpendCategories = (rows: any[]): SpendCategory[] => {
    return rows.map((row: any) => ({
      category: row.category || 'Uncategorized',
      amount: Number(row.amount || 0),
      percentage: Number(row.percentage || 0),
      change: 0,
      itemCount: Number(row.itemCount || 0),
    }));
  };

  // Format stock alerts
  const formatStockAlerts = (items: any[]): InventoryAlert[] => {
    return items.slice(0, 10).map((item) => ({
      itemId: item.id,
      itemName: item.name || item.description || 'Unknown Item',
      currentQty: item.qty_available || 0,
      minLevel: item.min_stock_level || 10,
      maxLevel: item.max_stock_level || 100,
      status: item.qty_available === 0 ? 'critical' : 'low',
      category: item.category_name || 'Uncategorized',
    }));
  };

  // Format cycle metrics from real per-stage timestamp diffs
  const formatCycleMetrics = (rows: any[]): CycleMetric[] => {
    return rows.map((row: any) => ({
      stage: row.stage || 'Unknown',
      avgDays: Number(row.avgDays || 0),
      minDays: Number(row.minDays || 0),
      maxDays: Number(row.maxDays || 0),
      trend: 'stable' as const,
    }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'critical': return 'text-red-500 bg-red-500/10';
      case 'low': return 'text-orange-500 bg-orange-500/10';
      case 'excess': return 'text-blue-500 bg-blue-500/10';
      default: return 'text-green-500 bg-green-500/10';
    }
  };

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-red-400" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-green-400" />;
    return <span className="h-4 w-4 text-gray-400">—</span>;
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Module Header - Constant Position */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <BarChart3 className="h-6 w-6 text-purple-500" />
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
            <ProcurementTabs activeTab="reports" categoriesOnly />
          </div>
        </div>

        {/* Page-specific controls */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-purple-500" />
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Reports</h2>
              </div>

              <div className="flex items-center gap-3">
                {/* Period Selector */}
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value as PeriodId)}
                  className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm"
                >
                  {PERIODS.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={fetchReportData}
                  className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
                  title="Refresh data"
                >
                  <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>

                <button className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            </div>
          ) : (
            <>
              {/* BOQ Spend vs Budget */}
              <div className="mb-6">
                <BOQSpendSummary />
              </div>

              {/* Summary Cards */}
              <div className="mb-6 grid grid-cols-4 gap-4">
                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <DollarSign className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Total Spend</p>
                      <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                        {formatCurrency(data?.summary.totalSpend || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Target className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Avg OTIF Rate</p>
                      <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                        {data?.summary.avgOtif || 0}%
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-orange-500/10">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                    </div>
                    <div>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Stock Alerts</p>
                      <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                        {data?.summary.stockAlerts || 0}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Clock className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                      <p className="text-sm text-[var(--ff-text-secondary)]">Avg Cycle Time</p>
                      <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                        {data?.summary.avgCycleTime || 0} days
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Report Sections */}
              <div className="grid grid-cols-2 gap-6">
                {/* Supplier Performance */}
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-blue-500" />
                      <h3 className="font-semibold text-[var(--ff-text-primary)]">Supplier Performance</h3>
                    </div>
                    <button className="text-sm text-blue-500 hover:text-blue-400">View All</button>
                  </div>
                  <div className="p-4">
                    <div className="space-y-3">
                      {data?.supplierMetrics.slice(0, 5).map((supplier) => (
                        <div
                          key={supplier.supplierId}
                          className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded-lg"
                        >
                          <div className="flex-1">
                            <p className="font-medium text-[var(--ff-text-primary)]">{supplier.supplierName}</p>
                            <p className="text-xs text-[var(--ff-text-tertiary)]">
                              {supplier.totalOrders} orders · {formatCurrency(supplier.totalValue)}
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="text-center">
                              <p className={`font-semibold ${supplier.otifRate >= 90 ? 'text-green-400' : supplier.otifRate >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {supplier.otifRate}%
                              </p>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">OTIF</p>
                            </div>
                            <div className="text-center">
                              <div className="flex items-center gap-1">
                                <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                                <span className="font-semibold text-[var(--ff-text-primary)]">{supplier.qualityScore}</span>
                              </div>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">Quality</p>
                            </div>
                            <div className="text-center">
                              <p className="font-semibold text-[var(--ff-text-primary)]">{supplier.avgLeadTime}d</p>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">Lead</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Spend by Category */}
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-green-500" />
                      <h3 className="font-semibold text-[var(--ff-text-primary)]">Spend by Category</h3>
                    </div>
                    <button className="text-sm text-green-500 hover:text-green-400">View All</button>
                  </div>
                  <div className="p-4">
                    <div className="space-y-3">
                      {data?.spendByCategory.map((category) => (
                        <div key={category.category} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-[var(--ff-text-primary)]">{category.category}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[var(--ff-text-primary)]">
                                {formatCurrency(category.amount)}
                              </span>
                              <span className={`text-xs ${category.change === 0 ? 'text-gray-400' : category.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {category.change === 0 ? '' : `${category.change >= 0 ? '+' : ''}${category.change}%`}
                              </span>
                            </div>
                          </div>
                          <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full transition-all"
                              style={{ width: `${category.percentage}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Inventory Alerts */}
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-orange-500" />
                      <h3 className="font-semibold text-[var(--ff-text-primary)]">Inventory Alerts</h3>
                    </div>
                    <button
                      onClick={() => router.push('/procurement/inventory?tab=stock')}
                      className="text-sm text-orange-500 hover:text-orange-400"
                    >
                      View All
                    </button>
                  </div>
                  <div className="p-4">
                    {data?.inventoryAlerts.length === 0 ? (
                      <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
                        <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                        <p>All stock levels healthy</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {data?.inventoryAlerts.slice(0, 6).map((alert) => (
                          <div
                            key={alert.itemId}
                            className="flex items-center justify-between p-2 bg-[var(--ff-bg-tertiary)] rounded-lg"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-[var(--ff-text-primary)] truncate">{alert.itemName}</p>
                              <p className="text-xs text-[var(--ff-text-tertiary)]">{alert.category}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                                  {alert.currentQty} / {alert.minLevel}
                                </p>
                              </div>
                              <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(alert.status)}`}>
                                {alert.status === 'critical' ? 'Critical' : 'Low'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Cycle Time Analysis */}
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-purple-500" />
                      <h3 className="font-semibold text-[var(--ff-text-primary)]">Cycle Time Analysis</h3>
                    </div>
                    <button className="text-sm text-purple-500 hover:text-purple-400">Details</button>
                  </div>
                  <div className="p-4">
                    <div className="space-y-3">
                      {data?.cycleMetrics.map((metric) => (
                        <div key={metric.stage} className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-sm text-[var(--ff-text-primary)]">{metric.stage}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <span className="text-lg font-semibold text-[var(--ff-text-primary)]">
                                {metric.avgDays}
                              </span>
                              <span className="text-sm text-[var(--ff-text-tertiary)] ml-1">days</span>
                            </div>
                            <div className="w-6 flex justify-center">
                              {getTrendIcon(metric.trend)}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="pt-3 mt-3 border-t border-[var(--ff-border-light)] flex items-center justify-between">
                        <p className="font-medium text-[var(--ff-text-primary)]">Total Cycle Time</p>
                        <div className="text-right">
                          <span className="text-xl font-bold text-purple-400">
                            {data?.summary.avgCycleTime || 0}
                          </span>
                          <span className="text-sm text-[var(--ff-text-tertiary)] ml-1">days avg</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
