/**
 * Supplier Performance Report Component
 * Comprehensive supplier analytics and performance metrics
 */

import {
  BarChart,
  Bar,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { StatusBadge } from '@/components/ui';
import {
  Users,
  Star,
  Award,
  CheckCircle
} from 'lucide-react';
import type { SupplierPerformanceReport as SupplierReportData } from '@/services/procurement/reports/procurementReportsService';

// 🟢 WORKING: Chart colors
const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0'];

interface SupplierPerformanceReportProps {
  data: SupplierReportData | null;
  loading?: boolean;
}

// 🟢 WORKING: Format currency helper
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

// 🟢 WORKING: Format percentage helper
const formatPercentage = (value: number) => {
  return `${value.toFixed(1)}%`;
};

// 🟢 WORKING: Performance badge component
function PerformanceBadge({ rating }: { rating: number }) {
  const getStatusLabel = (rating: number): string => {
    if (rating >= 4.5) return 'excellent';
    if (rating >= 3.5) return 'good';
    if (rating >= 2.5) return 'average';
    return 'poor';
  };

  return (
    <StatusBadge status={getStatusLabel(rating)} />
  );
}

// 🟢 WORKING: Main component
export function SupplierPerformanceReport({ data, loading }: SupplierPerformanceReportProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-lg mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">No supplier performance data available</p>
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
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Suppliers</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{data.totalSuppliers}</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Active Suppliers</p>
                <p className="text-3xl font-bold text-green-600">{data.activeSuppliers}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {formatPercentage((data.activeSuppliers / data.totalSuppliers) * 100)}
                </p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Average Rating</p>
                <p className="text-3xl font-bold text-yellow-600">{data.averageRating.toFixed(1)}</p>
                <div className="flex items-center mt-1">
                  {[...Array(5)].map((_, i) => (
                    <Star 
                      key={i} 
                      className={`w-4 h-4 ${
                        i < Math.floor(data.averageRating) 
                          ? 'text-yellow-400 fill-current' 
                          : 'text-gray-300'
                      }`} 
                    />
                  ))}
                </div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <Star className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Top Performers</p>
                <p className="text-3xl font-bold text-purple-600">
                  {data.topPerformers.filter(s => s.rating >= 4.5).length}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">4.5+ Rating</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <Award className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Performance Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.performanceDistribution}
                  dataKey="count"
                  nameKey="range"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  label={({ range, percentage }: { range: string; percentage: number }) => `${range}: ${percentage.toFixed(1)}%`}
                >
                  {data.performanceDistribution.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number, name: string) => [`${value} suppliers`, name]} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Compliance Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>Compliance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.complianceStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="metric" />
                <YAxis />
                <Tooltip formatter={(value: number, name: string) => [`${value} suppliers`, name]} />
                <Legend />
                <Bar dataKey="compliant" fill="#82ca9d" name="Compliant" />
                <Bar dataKey="nonCompliant" fill="#ff7c7c" name="Non-Compliant" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Performers Table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Suppliers</CardTitle>
        </CardHeader>
        <CardContent>
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
                    Performance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wide">
                    On-Time Delivery
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200">
                {data.topPerformers.slice(0, 10).map((supplier) => (
                  <tr key={supplier.supplierId} className="hover:bg-gray-50 dark:bg-gray-900">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {supplier.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            ID: {supplier.supplierId}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex items-center mr-2">
                          {[...Array(5)].map((_, i) => (
                            <Star 
                              key={i} 
                              className={`w-4 h-4 ${
                                i < Math.floor(supplier.rating) 
                                  ? 'text-yellow-400 fill-current' 
                                  : 'text-gray-300'
                              }`} 
                            />
                          ))}
                        </div>
                        <span className="text-sm text-gray-900 dark:text-gray-100">{supplier.rating.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                      {formatCurrency(supplier.totalSpend)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <PerformanceBadge rating={supplier.rating} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        supplier.onTimeDelivery >= 95 
                          ? 'bg-green-100 text-green-800' 
                          : supplier.onTimeDelivery >= 85 
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {formatPercentage(supplier.onTimeDelivery)}
                      </span>
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