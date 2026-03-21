/**
 * ProjectRevenue — Bar chart showing projected FC Activation count per project,
 * sourced from the Shareholder Model "Project_Detail" worksheet via SharePoint.
 */

'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useProjectRevenueData } from './useProjectRevenueData';
import { AlertCircle, Loader2 } from 'lucide-react';

// 🟢 WORKING: Project Revenue bar chart — FC Activation per project
export default function ProjectRevenue() {
  const { data, isLoading, error } = useProjectRevenueData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading project data&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const chartData = data?.data ?? [];
  const projectCount = data?.meta.projectCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-6">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider">Projects</p>
          <p className="text-2xl font-bold text-white">{projectCount}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider">Source</p>
          <p className="text-sm font-medium text-blue-400">Shareholder Model (live)</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 4, left: 140 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={{ stroke: '#4B5563' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="project"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={135}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#F9FAFB',
              }}
              formatter={(value: number) => [value.toLocaleString(), 'FC Activation']}
            />
            <Bar dataKey="fcActivation" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
