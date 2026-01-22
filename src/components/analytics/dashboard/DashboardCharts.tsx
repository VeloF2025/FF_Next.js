/**
 * Analytics Dashboard Charts Section
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from '@/components/ui/DynamicChart';
import { DashboardChartsProps } from './AnalyticsDashboardTypes';

export function DashboardCharts({ projectTrends, kpiDashboard }: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Project Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Project Completion Trends</CardTitle>
        </CardHeader>
        <CardContent>
          {projectTrends.length === 0 ? (
            <div className="flex items-center justify-center h-[300px]">
              <div className="text-center">
                <p className="text-[var(--ff-text-tertiary)]">No trend data available</p>
                <p className="text-sm text-[var(--ff-text-tertiary)]">Project trends will display here once data is available</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={projectTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="month" 
                  tickFormatter={(value: string | number) => new Date(value).toLocaleDateString('en-US', { month: 'short' })}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(value: string | number) => new Date(value).toISOString().split('T')[0]}
                />
                <Line 
                  type="monotone" 
                  dataKey="avgCompletion" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  name="Avg Completion %"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* KPI Overview */}
      <Card>
        <CardHeader>
          <CardTitle>KPI Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {kpiDashboard.length === 0 ? (
            <div className="flex items-center justify-center h-[300px]">
              <div className="text-center">
                <p className="text-[var(--ff-text-tertiary)]">No KPI data available</p>
                <p className="text-sm text-[var(--ff-text-tertiary)]">KPI metrics will display here once data is available</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={kpiDashboard}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="metricType" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="currentValue" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}