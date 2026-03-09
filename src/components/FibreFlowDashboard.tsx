/**
 * FibreFlow Dashboard - React Component
 *
 * Real-time monitoring dashboard for the FibreFlow proactive system.
 * Displays multi-agent convergence, consequence analysis, pattern learning,
 * knowledge graph, workload distribution, and conflict predictions.
 *
 * Integration:
 *   1. Copy this file to: src/components/FibreFlowDashboard.tsx
 *   2. Add route: <Route path="/fibreflow" element={<FibreFlowDashboard />} />
 *   3. Start API: python ui-module/fibreflow-dashboard-api.py
 *   4. Access: http://localhost:3000/fibreflow
 */

import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// API configuration
const API_BASE = 'http://100.96.203.105:8001/api/dashboard';

// Color palette
const COLORS = {
  primary: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  gray: '#6b7280'
};

const STATUS_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'];

interface OverviewData {
  queue: {
    total_tasks: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
  };
  learning: {
    total_feedback: number;
    approval_rate: number;
    rejection_rate: number;
  };
  team: {
    total_developers: number;
    overloaded_count: number;
    average_workload: number;
  };
}

interface ConsequenceData {
  overall_impact: string;
  deployment_risk: string;
  categories: {
    api: { level: string; reason: string };
    database: { level: string; reason: string };
    performance: { level: string; reason: string };
    user: { level: string; reason: string };
  };
  blast_radius: {
    affected_files: number;
    affected_users: string;
    blast_radius_score: string;
  };
  recommendations: string[];
}

interface PatternData {
  weights: Record<string, number>;
  summary: {
    total_feedback: number;
    approval_rate: number;
    rejection_rate: number;
  };
}

interface WorkloadData {
  total_developers: number;
  average_workload: number;
  distribution: {
    overloaded: number;
    busy: number;
    available: number;
    light: number;
  };
  developers: Array<{
    developer: string;
    score: number;
    level: string;
  }>;
}

const FibreFlowDashboard: React.FC = () => {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [consequences, setConsequences] = useState<ConsequenceData | null>(null);
  const [patterns, setPatterns] = useState<PatternData | null>(null);
  const [workload, setWorkload] = useState<WorkloadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Fetch all dashboard data
  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [overviewRes, consequencesRes, patternsRes, workloadRes] = await Promise.all([
        fetch(`${API_BASE}/overview`),
        fetch(`${API_BASE}/consequences/latest`),
        fetch(`${API_BASE}/patterns`),
        fetch(`${API_BASE}/workload`)
      ]);

      if (!overviewRes.ok || !consequencesRes.ok || !patternsRes.ok || !workloadRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const [overviewData, consequencesData, patternsData, workloadData] = await Promise.all([
        overviewRes.json(),
        consequencesRes.json(),
        patternsRes.json(),
        workloadRes.json()
      ]);

      setOverview(overviewData);
      setConsequences(consequencesData);
      setPatterns(patternsData);
      setWorkload(workloadData);
      setLastUpdate(new Date());

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Loading state
  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--ff-bg-primary)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-[var(--ff-text-secondary)]">Loading FibreFlow Dashboard...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--ff-bg-primary)]">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 max-w-md">
          <h2 className="text-red-400 font-semibold text-lg mb-2">Dashboard Error</h2>
          <p className="text-red-400/80">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ff-bg-primary)] p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">FibreFlow Dashboard</h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">Proactive AI System Monitoring - Jules Level 4</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-[var(--ff-text-secondary)]">Last Updated</div>
            <div className="text-sm font-medium text-[var(--ff-text-primary)]">
              {lastUpdate?.toLocaleTimeString() ?? 'Loading...'}
            </div>
            <button
              onClick={fetchDashboardData}
              className="mt-2 text-blue-400 hover:text-blue-300 text-sm font-medium"
            >
              Refresh Now
            </button>
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Tasks Queue */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Task Queue</h3>
            <div className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-sm font-medium">
              {overview?.queue.total_tasks || 0} Total
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">High Confidence</span>
              <span className="font-semibold text-green-400">
                {overview?.queue.high_confidence || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Medium Confidence</span>
              <span className="font-semibold text-yellow-400">
                {overview?.queue.medium_confidence || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Low Confidence</span>
              <span className="font-semibold text-[var(--ff-text-secondary)]">
                {overview?.queue.low_confidence || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Pattern Learning */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Pattern Learning</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Total Feedback</span>
              <span className="font-semibold">{overview?.learning.total_feedback || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Approval Rate</span>
              <span className="font-semibold text-green-400">
                {(overview?.learning.approval_rate || 0).toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Rejection Rate</span>
              <span className="font-semibold text-red-400">
                {(overview?.learning.rejection_rate || 0).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Team Status */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Team Status</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Active Developers</span>
              <span className="font-semibold">{overview?.team.total_developers || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Overloaded</span>
              <span className="font-semibold text-red-400">
                {overview?.team.overloaded_count || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[var(--ff-text-secondary)]">Avg Workload</span>
              <span className="font-semibold">
                {((overview?.team.average_workload || 0) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Consequence Analysis */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Latest Commit Impact</h3>

          {consequences && (
            <>
              <div className="mb-4 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm text-[var(--ff-text-secondary)]">Overall Impact</div>
                    <div className={`text-2xl font-bold ${
                      consequences.overall_impact === 'critical' ? 'text-red-400' :
                      consequences.overall_impact === 'high' ? 'text-orange-400' :
                      consequences.overall_impact === 'medium' ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {consequences.overall_impact.toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-[var(--ff-text-secondary)]">Deployment Risk</div>
                    <div className="text-xl font-semibold text-[var(--ff-text-primary)]">
                      {consequences.deployment_risk.replace('_', ' ').toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {Object.entries(consequences.categories).map(([category, data]) => (
                  <div key={category} className="flex items-center justify-between p-2 bg-[var(--ff-bg-tertiary)] rounded">
                    <span className="font-medium capitalize">{category}</span>
                    <span className={`px-2 py-1 rounded text-sm font-medium ${
                      data.level === 'critical' ? 'bg-red-500/20 text-red-400' :
                      data.level === 'high' ? 'bg-orange-500/20 text-orange-400' :
                      data.level === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      data.level === 'low' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {data.level.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>

              {consequences.recommendations.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Recommendations:</div>
                  <ul className="space-y-1">
                    {consequences.recommendations.slice(0, 3).map((rec, idx) => (
                      <li key={idx} className="text-sm text-[var(--ff-text-secondary)] flex items-start">
                        <span className="text-blue-400 mr-2">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Workload Distribution */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Team Workload</h3>

          {workload && (
            <>
              <div className="mb-6">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Overloaded', value: workload.distribution.overloaded },
                        { name: 'Busy', value: workload.distribution.busy },
                        { name: 'Available', value: workload.distribution.available },
                        { name: 'Light', value: workload.distribution.light }
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${percent !== undefined ? (percent * 100).toFixed(0) : '0'}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {STATUS_COLORS.map((color, index) => (
                        <Cell key={`cell-${index}`} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {workload.developers.slice(0, 5).map((dev, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm text-[var(--ff-text-secondary)] truncate flex-1 mr-2">
                      {dev.developer.split('@')[0]}
                    </span>
                    <div className="flex items-center">
                      <div className="w-32 bg-[var(--ff-bg-tertiary)] rounded-full h-2 mr-2">
                        <div
                          className={`h-2 rounded-full ${
                            dev.score >= 0.8 ? 'bg-red-500' :
                            dev.score >= 0.6 ? 'bg-orange-500' :
                            dev.score >= 0.4 ? 'bg-blue-500' :
                            'bg-green-500'
                          }`}
                          style={{ width: `${dev.score * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-xs font-medium text-[var(--ff-text-secondary)] w-8">
                        {(dev.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Pattern Weights */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Pattern Confidence Weights</h3>

          {patterns && patterns.weights && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={Object.entries(patterns.weights).map(([name, value]) => ({
                  name: name.replace(/_/g, ' '),
                  weight: value
                }))}
                margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  tick={{ fontSize: 12 }}
                />
                <YAxis domain={[0, 1]} />
                <Tooltip />
                <Bar dataKey="weight" fill={COLORS.primary} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-[var(--ff-text-secondary)]">
        <p>FibreFlow Proactive System v4.0 - Jules Level 4 (Team Alignment)</p>
        <p className="mt-1">Auto-refresh every 30 seconds</p>
      </div>
    </div>
  );
};

export default FibreFlowDashboard;
