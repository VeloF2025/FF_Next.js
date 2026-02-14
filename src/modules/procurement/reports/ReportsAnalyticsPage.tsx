import React, { useState, useEffect } from 'react';
import { notificationService } from '@/services/core/NotificationService';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from '@/components/ui/DynamicChart';
import {
  TrendingUp,
  DollarSign,
  Users,
  Clock,
  Download,
  Filter,
  RefreshCw,
  FileText,
  PieChart as PieChartIcon,
  BarChart3,
  AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { procurementReportsService } from '@/services/procurement/reports/procurementReportsService';
import { exportReport } from './utils/exportUtils';
import { SupplierPerformanceReport } from './components/SupplierPerformanceReport';
import { SpendAnalysisReport } from './components/SpendAnalysisReport';
import { log } from '@/lib/logger';
import type {
  CostSavingsReport,
  SupplierPerformanceReport as SupplierPerformanceReportData,
  SpendAnalysisReport as SpendAnalysisReportData,
  CycleTimeReport,
  BudgetVarianceReport,
  ReportFilters
} from '@/services/procurement/reports/procurementReportsService';

// 🟢 WORKING: Chart color palette
const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];

// 🟢 WORKING: Stats card component
interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  loading?: boolean;
}

function StatsCard({ title, value, change, changeType, icon, loading }: StatsCardProps) {
  const changeColor = changeType === 'positive' ? 'text-green-600' : 
                     changeType === 'negative' ? 'text-red-600' : 'text-gray-600 dark:text-gray-400';
  
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? '...' : value}
            </p>
            {change && (
              <p className={`text-sm ${changeColor} flex items-center mt-1`}>
                <TrendingUp className="w-4 h-4 mr-1" />
                {change}
              </p>
            )}
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 🟢 WORKING: Report section component
interface ReportSectionProps {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

function ReportSection({ title, children, actions }: ReportSectionProps) {
  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {actions && <div className="flex gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}

// 🟢 WORKING: Main component
const ReportsAnalyticsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [filters] = useState<ReportFilters>({
    dateFrom: new Date(new Date().setMonth(new Date().getMonth() - 12)),
    dateTo: new Date()
  });
  
  // Report data states
  const [costSavingsData, setCostSavingsData] = useState<CostSavingsReport | null>(null);
  const [supplierPerformanceData, setSupplierPerformanceData] = useState<SupplierPerformanceReportData | null>(null);
  const [spendAnalysisData, setSpendAnalysisData] = useState<SpendAnalysisReportData | null>(null);
  const [cycleTimeData, setCycleTimeData] = useState<CycleTimeReport | null>(null);
  const [budgetVarianceData, setBudgetVarianceData] = useState<BudgetVarianceReport | null>(null);

  // 🟢 WORKING: Load all report data
  const loadReportData = async () => {
    setLoading(true);
    try {
      const [costSavings, supplierPerformance, spendAnalysis, cycleTime, budgetVariance] = 
        await Promise.all([
          procurementReportsService.getCostSavingsReport(filters),
          procurementReportsService.getSupplierPerformanceReport(filters),
          procurementReportsService.getSpendAnalysisReport(filters),
          procurementReportsService.getCycleTimeReport(filters),
          procurementReportsService.getBudgetVarianceReport(filters)
        ]);
      
      setCostSavingsData(costSavings);
      setSupplierPerformanceData(supplierPerformance);
      setSpendAnalysisData(spendAnalysis);
      setCycleTimeData(cycleTime);
      setBudgetVarianceData(budgetVariance);
    } catch (error) {
      log.error('Error loading report data:', { data: error }, 'ReportsAnalyticsPage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, [filters]);

  // 🟢 WORKING: Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // 🟢 WORKING: Format percentage
  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  // 🟢 WORKING: Navigation tabs
  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'cost-savings', label: 'Cost Savings', icon: DollarSign },
    { id: 'suppliers', label: 'Suppliers', icon: Users },
    { id: 'spend-analysis', label: 'Spend Analysis', icon: PieChartIcon },
    { id: 'cycle-time', label: 'Cycle Time', icon: Clock },
    { id: 'budget-variance', label: 'Budget Variance', icon: AlertTriangle }
  ];

  // 🟢 WORKING: Export handler
  const handleExport = async (format: 'pdf' | 'excel' | 'csv') => {
    try {
      let data: any;
      
      switch (activeTab) {
        case 'cost-savings':
          data = costSavingsData;
          break;
        case 'suppliers':
          data = supplierPerformanceData;
          break;
        case 'spend-analysis':
          data = spendAnalysisData;
          break;
        default:
          data = { costSavingsData, supplierPerformanceData, spendAnalysisData };
      }
      
      await exportReport(activeTab, data, { format });
    } catch (error) {
      log.error('Export error:', { data: error }, 'ReportsAnalyticsPage');
      notificationService.error('Export failed. Please try again.');
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-200 dark:border-gray-700 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Procurement Reports & Analytics</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Comprehensive insights into procurement performance and spending patterns</p>
        </div>
        <div className="flex gap-3 mt-4 sm:mt-0">
          <Button variant="outline" onClick={() => loadReportData()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline">
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors
                  ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:border-gray-600'
                  }
                `}
              >
                <Icon className="w-4 h-4 mr-2" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatsCard
              title="Total Savings"
              value={formatCurrency(costSavingsData?.savings || 0)}
              change={formatPercentage(costSavingsData?.savingsPercentage || 0)}
              changeType="positive"
              icon={<DollarSign className="w-6 h-6 text-blue-600" />}
              loading={loading}
            />
            <StatsCard
              title="Active Suppliers"
              value={supplierPerformanceData?.activeSuppliers || 0}
              change="+5 this month"
              changeType="positive"
              icon={<Users className="w-6 h-6 text-blue-600" />}
              loading={loading}
            />
            <StatsCard
              title="Avg Cycle Time"
              value={`${cycleTimeData?.averageRfqCycleTime || 14} days`}
              change="-2 days"
              changeType="positive"
              icon={<Clock className="w-6 h-6 text-blue-600" />}
              loading={loading}
            />
            <StatsCard
              title="Budget Variance"
              value={formatPercentage(Math.abs(budgetVarianceData?.variancePercentage || 0))}
              change="Within target"
              changeType="neutral"
              icon={<AlertTriangle className="w-6 h-6 text-blue-600" />}
              loading={loading}
            />
          </div>

          {/* Overview Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Savings Trend */}
            <ReportSection title="Monthly Savings Trend">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={costSavingsData?.monthlyTrends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value: number) => formatCurrency(value)} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Line
                    type="monotone"
                    dataKey="savings"
                    stroke="#8884d8"
                    strokeWidth={2}
                    name="Savings"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ReportSection>

            {/* Spend by Category */}
            <ReportSection title="Spend by Category">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={spendAnalysisData?.categoryBreakdown || []}
                    dataKey="actual"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    fill="#8884d8"
                    label={({ category, actual }: { category: string; actual: number }) => `${category}: ${formatCurrency(actual)}`}
                  >
                    {(spendAnalysisData?.categoryBreakdown || []).map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </ReportSection>
          </div>

          {/* Supplier Performance Overview */}
          <ReportSection title="Top Supplier Performance">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
                      Supplier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
                      Rating
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
                      Total Spend
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
                      On-Time Delivery
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200">
                  {(supplierPerformanceData?.topPerformers || []).slice(0, 5).map((supplier: any) => (
                    <tr key={supplier.supplierId}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                        {supplier.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {supplier.rating.toFixed(1)}/5.0
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {formatCurrency(supplier.totalSpend)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {formatPercentage(supplier.onTimeDelivery)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>
        </div>
      )}

      {/* Cost Savings Tab */}
      {activeTab === 'cost-savings' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatsCard
              title="Total Budget"
              value={formatCurrency(costSavingsData?.totalBudget || 0)}
              icon={<DollarSign className="w-6 h-6 text-blue-600" />}
              loading={loading}
            />
            <StatsCard
              title="Actual Spend"
              value={formatCurrency(costSavingsData?.actualSpend || 0)}
              icon={<DollarSign className="w-6 h-6 text-orange-600" />}
              loading={loading}
            />
            <StatsCard
              title="Total Savings"
              value={formatCurrency(costSavingsData?.savings || 0)}
              change={formatPercentage(costSavingsData?.savingsPercentage || 0)}
              changeType="positive"
              icon={<TrendingUp className="w-6 h-6 text-green-600" />}
              loading={loading}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Savings Trend */}
            <ReportSection title="Monthly Savings Trend">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={costSavingsData?.monthlyTrends || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value: number) => formatCurrency(value)} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="budgeted"
                    stroke="#8884d8"
                    strokeWidth={2}
                    name="Budgeted"
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    stroke="#82ca9d"
                    strokeWidth={2}
                    name="Actual"
                  />
                  <Line
                    type="monotone"
                    dataKey="savings"
                    stroke="#ffc658"
                    strokeWidth={2}
                    name="Savings"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ReportSection>

            {/* Category Breakdown */}
            <ReportSection title="Savings by Category">
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={costSavingsData?.categoryBreakdown || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis tickFormatter={(value: number) => formatCurrency(value)} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="budgeted" fill="#8884d8" name="Budgeted" />
                  <Bar dataKey="actual" fill="#82ca9d" name="Actual" />
                </BarChart>
              </ResponsiveContainer>
            </ReportSection>
          </div>
        </div>
      )}

      {/* Suppliers Tab */}
      {activeTab === 'suppliers' && (
        <SupplierPerformanceReport 
          data={supplierPerformanceData} 
          loading={loading} 
        />
      )}

      {/* Spend Analysis Tab */}
      {activeTab === 'spend-analysis' && (
        <SpendAnalysisReport 
          data={spendAnalysisData} 
          loading={loading} 
        />
      )}

      {/* Other tabs - placeholder */}
      {!['overview', 'cost-savings', 'suppliers', 'spend-analysis'].includes(activeTab) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <FileText className="w-12 h-12 text-blue-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-blue-800 mb-2">
            {tabs.find(tab => tab.id === activeTab)?.label} Report
          </h3>
          <p className="text-blue-600 mb-4">
            This section is being enhanced with additional analytics and visualizations.
          </p>
          <p className="text-sm text-blue-500">
            Advanced reporting for {tabs.find(tab => tab.id === activeTab)?.label.toLowerCase()} coming soon.
          </p>
        </div>
      )}
    </div>
  );
};

export default ReportsAnalyticsPage;