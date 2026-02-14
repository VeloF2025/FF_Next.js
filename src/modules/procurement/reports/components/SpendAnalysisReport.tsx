/**
 * Spend Analysis Report Component
 * Comprehensive spending analytics and breakdowns
 */

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from '@/components/ui/DynamicChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import {
  DollarSign,
  TrendingUp,
  Package,
  Building2
} from 'lucide-react';
import type { SpendAnalysisReport as SpendReportData } from '@/services/procurement/reports/procurementReportsService';

// 🟢 WORKING: Chart colors
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

interface SpendAnalysisReportProps {
  data: SpendReportData | null;
  loading?: boolean;
}

// 🟢 WORKING: Format helpers
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

export function SpendAnalysisReport({ data, loading }: SpendAnalysisReportProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-32 bg-secondary rounded-lg mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-secondary rounded-lg"></div>
            <div className="h-64 bg-secondary rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-muted-foreground">No spending data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Spend</p>
                <p className="text-3xl font-bold text-foreground">
                  {formatCurrency(data.totalSpend)}
                </p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <DollarSign className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Categories</p>
                <p className="text-3xl font-bold text-green-600">
                  {data.categoryBreakdown.length}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Active categories</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <Package className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Suppliers</p>
                <p className="text-3xl font-bold text-purple-600">
                  {data.supplierBreakdown.length}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Active suppliers</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <Building2 className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Order Value</p>
                <p className="text-3xl font-bold text-orange-600">
                  {data.monthlyTrends.length > 0 
                    ? formatCurrency(data.monthlyTrends.reduce((sum, month) => sum + month.averageOrderValue, 0) / data.monthlyTrends.length)
                    : '$0'
                  }
                </p>
              </div>
              <div className="p-3 bg-orange-50 rounded-lg">
                <TrendingUp className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Spend Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Spend by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.categoryBreakdown}
                  dataKey="actual"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  label={({ category, actual }: { category: string; actual: number }) => `${category}: ${formatCurrency(actual)}`}
                >
                  {data.categoryBreakdown.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Monthly Spend Trends */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Spend Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(value: number) => formatCurrency(value)} />
                <Tooltip 
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  labelFormatter={(month: string) => `Month: ${month}`}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="totalSpend" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  name="Total Spend"
                />
                <Line 
                  type="monotone" 
                  dataKey="averageOrderValue" 
                  stroke="#82ca9d" 
                  strokeWidth={2}
                  name="Avg Order Value"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Suppliers by Spend */}
      <Card>
        <CardHeader>
          <CardTitle>Top Suppliers by Spend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={data.supplierBreakdown.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="supplierName" 
                angle={-45}
                textAnchor="end"
                height={100}
              />
              <YAxis tickFormatter={(value: number) => formatCurrency(value)} />
              <Tooltip 
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
              <Legend />
              <Bar dataKey="totalSpend" fill="#8884d8" name="Total Spend" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Spending Table */}
      <Card>
        <CardHeader>
          <CardTitle>Category Spending Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-background">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                    Budgeted
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                    Actual Spend
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                    Variance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                    % of Total
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-gray-200">
                {data.categoryBreakdown.map((category) => (
                  <tr key={category.category} className="hover:bg-background">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {category.category}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatCurrency(category.budgeted)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatCurrency(category.actual)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        category.variance > 0 
                          ? 'bg-red-100 text-red-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {formatCurrency(Math.abs(category.variance))} 
                        {category.variance > 0 ? ' over' : ' under'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {((category.actual / data.totalSpend) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}