/**
 * Drop Dashboard Page
 * Route: /drops/dashboard
 *
 * Monitors QA photo review submissions from WhatsApp groups
 * Features:
 * - Date range filtering with quick filters
 * - Visual trend charts (line, bar, donut)
 * - Advanced metrics (failures, resubmissions, agent performance)
 * - CSV export functionality
 * - Real-time updates every 30 seconds
 */

'use client';

import { useState, useMemo } from 'react';

// Disable static generation - this page needs client-side data fetching
export const dynamic = 'force-dynamic';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/hooks/useProjects';
import { useWaMonitorSummary } from '@/modules/wa-monitor/hooks/useWaMonitorStats';
import {
  CheckCircle,
  FolderKanban,
  Activity,
  Plus,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Download,
  Calendar,
  Users,
  XCircle,
  BarChart3,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { format, subDays, startOfWeek, startOfMonth, endOfMonth } from 'date-fns';

// Chart colors
const COLORS = {
  complete: '#10b981',
  incomplete: '#f59e0b',
  pending: '#ef4444',
  primary: '#3b82f6',
  secondary: '#8b5cf6',
};

type DateRangePreset = 'today' | 'week' | 'month' | 'custom';

export default function DropDashboard() {
  const router = useRouter();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();

  // Date range state
  const [datePreset, setDatePreset] = useState<DateRangePreset>('today');
  const [startDate, setStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedProject, setSelectedProject] = useState<string>('all');

  // Fetch data with date range
  const { data: waStats, isLoading: waLoading, error: waError } = useWaMonitorSummary(startDate, endDate);

  // Handle date preset changes
  const handlePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    const today = new Date();

    switch (preset) {
      case 'today':
        setStartDate(format(today, 'yyyy-MM-dd'));
        setEndDate(format(today, 'yyyy-MM-dd'));
        break;
      case 'week':
        setStartDate(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        setEndDate(format(today, 'yyyy-MM-dd'));
        break;
      case 'month':
        setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'));
        setEndDate(format(today, 'yyyy-MM-dd'));
        break;
      case 'custom':
        // Keep current dates for custom
        break;
    }
  };

  // Calculate project stats
  const activeProjects = projects.filter(p => p.status === 'active').length;
  const totalProjects = projects.length;

  // Helper to find project ID by name for navigation
  const findProjectIdByName = (projectName: string): string | null => {
    const project = projects.find(p =>
      p.name?.toLowerCase() === projectName.toLowerCase() ||
      p.projectName?.toLowerCase() === projectName.toLowerCase()
    );
    return project?.id || project?.projectId || null;
  };

  // Filter stats by selected project
  const filteredWaStats = useMemo(() => {
    if (!waStats) return null;
    if (selectedProject === 'all') return waStats;

    const projectData = waStats.byProject?.find(p => p.project === selectedProject);
    if (!projectData) return waStats;

    return {
      ...waStats,
      total: projectData.total,
      complete: projectData.complete,
      incomplete: projectData.total - projectData.complete,
      completionRate: projectData.completionRate,
    };
  }, [waStats, selectedProject]);

  // Prepare chart data
  const projectComparisonData = useMemo(() => {
    if (!waStats?.byProject) return [];
    return waStats.byProject.map(p => ({
      name: p.project,
      Complete: p.complete,
      Incomplete: p.total - p.complete,
      rate: p.completionRate,
    }));
  }, [waStats]);

  const completionPieData = useMemo(() => {
    if (!filteredWaStats) return [];
    return [
      { name: 'Complete', value: filteredWaStats.complete, color: COLORS.complete },
      { name: 'Incomplete', value: filteredWaStats.incomplete, color: COLORS.incomplete },
    ];
  }, [filteredWaStats]);

  // Export to CSV
  const exportToCSV = () => {
    if (!waStats?.byProject) return;

    const headers = ['Project', 'Total Drops', 'Complete', 'Incomplete', 'Completion Rate (%)', 'Overall Total', 'Overall Complete'];
    const rows = waStats.byProject.map(p => [
      p.project,
      p.total,
      p.complete,
      p.total - p.complete,
      p.completionRate,
      p.overallTotal || 0,
      p.overallComplete || 0,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
      '',
      `Summary,,,,,,`,
      `Total,${waStats.total},,,,`,
      `Complete,${waStats.complete},,,,`,
      `Incomplete,${waStats.incomplete},,,,`,
      `Completion Rate,${waStats.completionRate}%,,,,`,
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drop-dashboard-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Drop Dashboard</h1>
            <p className="mt-2 text-gray-600">Monitor QA photo review submissions from WhatsApp groups</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={exportToCSV}
              disabled={!waStats}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Download className="h-5 w-5 mr-2" />
              Export CSV
            </button>
            <button
              onClick={() => router.push('/projects/new')}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="h-5 w-5 mr-2" />
              New Project
            </button>
          </div>
        </div>

        {/* Date Range Controls */}
        <div className="mb-6 bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center mb-4">
            <Calendar className="h-5 w-5 text-blue-600 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Date Range</h2>
          </div>

          <div className="flex flex-wrap gap-4 items-end">
            {/* Quick Filter Buttons */}
            <div className="flex gap-2">
              {(['today', 'week', 'month', 'custom'] as DateRangePreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => handlePresetChange(preset)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    datePreset === preset
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </button>
              ))}
            </div>

            {/* Custom Date Inputs */}
            {datePreset === 'custom' && (
              <>
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </>
            )}

            {/* Project Filter */}
            <div className="flex flex-col ml-auto">
              <label className="text-sm font-medium text-gray-700 mb-1">Filter by Project</label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Projects</option>
                {waStats?.byProject?.map(p => (
                  <option key={p.project} value={p.project}>
                    {p.project} ({p.total} drops)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Range Display */}
          <div className="mt-4 text-sm text-gray-600">
            Showing data from <span className="font-semibold">{startDate}</span> to <span className="font-semibold">{endDate}</span>
          </div>
        </div>

        {/* Executive Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Drops */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Activity className="h-6 w-6 text-blue-600" />
              </div>
              {waStats?.trends && (
                <div className="flex items-center text-sm">
                  {waStats.trends.weekly.total > waStats.total ? (
                    <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600 mr-1" />
                  )}
                  <span className="text-gray-600">vs week</span>
                </div>
              )}
            </div>
            <h3 className="text-sm font-medium text-gray-600 mb-1">Total Drops</h3>
            <p className="text-3xl font-bold text-gray-900">
              {waLoading ? '...' : filteredWaStats?.total || 0}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Week: {waStats?.trends?.weekly.total || 0} | Month: {waStats?.trends?.monthly.total || 0}
            </p>
          </div>

          {/* Completion Rate */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-green-50 rounded-lg">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
            <h3 className="text-sm font-medium text-gray-600 mb-1">Completion Rate</h3>
            <p className="text-3xl font-bold text-green-600">
              {waLoading ? '...' : `${filteredWaStats?.completionRate || 0}%`}
            </p>
            <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${filteredWaStats?.completionRate || 0}%` }}
              />
            </div>
          </div>

          {/* First-Time Pass Rate */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-purple-50 rounded-lg">
                <TrendingUp className="h-6 w-6 text-purple-600" />
              </div>
            </div>
            <h3 className="text-sm font-medium text-gray-600 mb-1">First-Time Pass Rate</h3>
            <p className="text-3xl font-bold text-purple-600">
              {waLoading ? '...' : `${waStats?.resubmissions?.firstTimePassRate || 0}%`}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Resubmissions: {waStats?.resubmissions?.total || 0} ({waStats?.resubmissions?.rate || 0}%)
            </p>
          </div>

          {/* Feedback Sent */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 bg-orange-50 rounded-lg">
                <Users className="h-6 w-6 text-orange-600" />
              </div>
            </div>
            <h3 className="text-sm font-medium text-gray-600 mb-1">Feedback Sent</h3>
            <p className="text-3xl font-bold text-orange-600">
              {waLoading ? '...' : waStats?.feedbackStats?.sent || 0}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Pending: {waStats?.feedbackStats?.pending || 0} | Rate: {waStats?.feedbackStats?.sendRate || 0}%
            </p>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Project Comparison Bar Chart */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center mb-6">
              <div className="p-2 bg-blue-50 rounded-lg">
                <BarChart3 className="h-6 w-6 text-blue-600" />
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Drops by Project</h2>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={projectComparisonData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Complete" fill={COLORS.complete} />
                <Bar dataKey="Incomplete" fill={COLORS.incomplete} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Completion Pie Chart */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center mb-6">
              <div className="p-2 bg-green-50 rounded-lg">
                <Activity className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Completion Overview</h2>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={completionPieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {completionPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Common Failures Section */}
        {waStats?.commonFailures && waStats.commonFailures.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <div className="flex items-center mb-6">
              <div className="p-2 bg-red-50 rounded-lg">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Top 5 Common Failure Points</h2>
            </div>
            <div className="space-y-4">
              {waStats.commonFailures.map((failure, idx) => (
                <div key={idx} className="flex items-center">
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-gray-900">{failure.step}</span>
                      <span className="text-sm text-gray-600">{failure.count} failures ({failure.percentage}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
                        style={{ width: `${failure.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agent Performance Section */}
        {waStats?.agentPerformance && waStats.agentPerformance.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <div className="flex items-center mb-6">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Top 10 Agent Performance</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agent</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Drops</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Completion Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {waStats.agentPerformance.map((agent, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">#{idx + 1}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{agent.agent}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{agent.drops}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-right">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          agent.completionRate >= 90 ? 'bg-green-100 text-green-800' :
                          agent.completionRate >= 70 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {agent.completionRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Projects by WA Monitor Stats Table */}
        {waStats?.byProject && waStats.byProject.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
            <div className="flex items-center mb-6">
              <div className="p-2 bg-blue-50 rounded-lg">
                <FolderKanban className="h-6 w-6 text-blue-600" />
              </div>
              <h2 className="ml-3 text-lg font-semibold text-gray-900">Detailed Stats by Project</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Project</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Period Total</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Complete</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Incomplete</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">All-Time Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {waStats.byProject.map((project) => {
                    const projectId = findProjectIdByName(project.project);
                    return (
                    <tr
                      key={project.project}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => {
                        if (projectId) {
                          router.push(`/projects/${projectId}`);
                        } else {
                          // Fallback: filter dashboard by this project if no ID found
                          setSelectedProject(project.project);
                        }
                      }}
                      title={projectId ? `View ${project.project} details` : `Filter by ${project.project}`}
                    >
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{project.project}</div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                        {project.total}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium text-green-600">
                        {project.complete}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium text-orange-600">
                        {project.total - project.complete}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          project.completionRate >= 80 ? 'bg-green-100 text-green-800' :
                          project.completionRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {project.completionRate}%
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">
                        {project.overallTotal || 0}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Error State */}
        {waError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-8">
            <div className="flex items-center text-red-800">
              <AlertTriangle className="h-5 w-5 mr-2" />
              <span className="font-medium">Error loading dashboard data. Please try again.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
