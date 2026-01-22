/**
 * Health & Safety Dashboard
 *
 * Main entry point for the H&S module showing:
 * - Overall safety metrics
 * - Incident summary
 * - Contractor compliance overview
 * - Project audit status
 * - Upcoming audits
 * - Recent activity
 */

import React from 'react';
import Head from 'next/head';
import useSWR from 'swr';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Users,
  Building2,
  Calendar,
  ChevronRight,
  AlertOctagon,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { AppLayout } from '@/components/layout';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function HealthSafetyDashboard() {
  const { data, error, isLoading } = useSWR('/api/health-safety/dashboard', fetcher);

  const dashboard = data?.data;

  return (
    <AppLayout>
      <Head>
        <title>Health & Safety | FibreFlow</title>
      </Head>

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Shield className="w-8 h-8 text-green-500" />
              Health & Safety
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Monitor safety compliance across projects and contractors
            </p>
          </div>

          <div className="flex gap-3">
            <a
              href="/health-safety/incidents/new"
              className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              Report Incident
            </a>
            <a
              href="/health-safety/checklists"
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
            >
              <FileText className="w-4 h-4" />
              Manage Checklists
            </a>
          </div>
        </div>

        {isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <ErrorState />
        ) : (
          <>
            {/* Alerts */}
            {(dashboard?.incidents?.alerts?.critical_open > 0 ||
              dashboard?.incidents?.alerts?.dol_pending > 0) && (
              <AlertBanner
                criticalOpen={dashboard.incidents.alerts.critical_open}
                dolPending={dashboard.incidents.alerts.dol_pending}
                caPending={dashboard.incidents.alerts.ca_pending}
              />
            )}

            {/* Overall Score */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <OverallScoreCard
                score={dashboard?.overall?.score}
                ragStatus={dashboard?.overall?.rag_status}
                projectsConfigured={dashboard?.overall?.total_projects_configured}
              />

              <StatsCard
                title="Open Incidents"
                value={dashboard?.incidents?.stats?.open_incidents || 0}
                icon={AlertTriangle}
                color="red"
                trend={dashboard?.incidents?.stats?.total_incidents > 0 ? 'down' : undefined}
                subtitle={`${dashboard?.incidents?.stats?.total_incidents || 0} total (12 months)`}
              />

              <StatsCard
                title="Contractors Compliant"
                value={dashboard?.contractors?.by_rag?.green || 0}
                icon={Users}
                color="green"
                subtitle={`${dashboard?.contractors?.at_risk?.length || 0} at risk`}
              />

              <StatsCard
                title="Overdue Audits"
                value={dashboard?.audits?.overdue_count || 0}
                icon={Calendar}
                color="orange"
                subtitle={`${dashboard?.audits?.upcoming?.length || 0} due soon`}
              />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Incidents Summary */}
              <div className="lg:col-span-2">
                <IncidentsSummary
                  stats={dashboard?.incidents?.stats}
                  trend={dashboard?.incidents?.trend}
                />
              </div>

              {/* Contractors at Risk */}
              <ContractorsAtRisk contractors={dashboard?.contractors?.at_risk} />
            </div>

            {/* Second Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Upcoming Audits */}
              <UpcomingAudits
                upcoming={dashboard?.audits?.upcoming}
                overdue={dashboard?.audits?.overdue}
              />

              {/* Project RAG Distribution */}
              <ProjectRAGDistribution ragStats={dashboard?.audits?.by_rag} />
            </div>

            {/* Recent Activity */}
            <RecentActivity activity={dashboard?.recent_activity} />
          </>
        )}
      </div>
    </AppLayout>
  );
}

// Sub-components

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-64 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
      <p className="text-red-600 dark:text-red-400 font-medium">Failed to load dashboard data</p>
      <p className="text-sm text-red-500 dark:text-red-300 mt-1">Please try refreshing the page</p>
    </div>
  );
}

function AlertBanner({
  criticalOpen,
  dolPending,
  caPending,
}: {
  criticalOpen: number;
  dolPending: number;
  caPending: number;
}) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-4">
      <AlertOctagon className="w-6 h-6 text-red-500 flex-shrink-0" />
      <div className="flex-1">
        <h3 className="font-semibold text-red-800 dark:text-red-200">Attention Required</h3>
        <div className="flex flex-wrap gap-4 mt-2 text-sm">
          {criticalOpen > 0 && (
            <span className="text-red-600 dark:text-red-300">
              <strong>{criticalOpen}</strong> critical incidents open
            </span>
          )}
          {dolPending > 0 && (
            <span className="text-red-600 dark:text-red-300">
              <strong>{dolPending}</strong> DoL reports pending
            </span>
          )}
          {caPending > 0 && (
            <span className="text-orange-600 dark:text-orange-300">
              <strong>{caPending}</strong> corrective actions pending
            </span>
          )}
        </div>
      </div>
      <a
        href="/health-safety/incidents?status=open"
        className="text-red-600 dark:text-red-400 hover:underline text-sm"
      >
        View All
      </a>
    </div>
  );
}

function OverallScoreCard({
  score,
  ragStatus,
  projectsConfigured,
}: {
  score?: number;
  ragStatus?: string;
  projectsConfigured?: number;
}) {
  const ragColors = {
    green: 'from-green-500 to-green-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
  };

  return (
    <div
      className={`bg-gradient-to-br ${ragColors[ragStatus as keyof typeof ragColors] || 'from-gray-500 to-gray-600'} rounded-lg p-6 text-white`}
    >
      <div className="flex items-center justify-between mb-4">
        <Shield className="w-8 h-8 opacity-80" />
        <span className="text-xs uppercase tracking-wider opacity-80">Overall Score</span>
      </div>
      <div className="text-4xl font-bold mb-2">{score ?? 'N/A'}%</div>
      <p className="text-sm opacity-80">{projectsConfigured || 0} projects configured</p>
    </div>
  );
}

function StatsCard({
  title,
  value,
  icon: Icon,
  color,
  trend,
  subtitle,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: 'green' | 'red' | 'orange' | 'blue';
  trend?: 'up' | 'down';
  subtitle?: string;
}) {
  const colors = {
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <span className={trend === 'down' ? 'text-green-500' : 'text-red-500'}>
            {trend === 'down' ? (
              <TrendingDown className="w-5 h-5" />
            ) : (
              <TrendingUp className="w-5 h-5" />
            )}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
      <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function IncidentsSummary({
  stats,
  trend,
}: {
  stats?: any;
  trend?: any[];
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Incident Summary</h3>
        <a
          href="/health-safety/incidents"
          className="text-sm text-orange-500 hover:text-orange-600 flex items-center gap-1"
        >
          View All <ChevronRight className="w-4 h-4" />
        </a>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-2xl font-bold text-red-600">{stats?.critical || 0}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Critical</p>
        </div>
        <div className="text-center p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
          <p className="text-2xl font-bold text-orange-600">{stats?.major || 0}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Major</p>
        </div>
        <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <p className="text-2xl font-bold text-yellow-600">{stats?.moderate || 0}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Moderate</p>
        </div>
        <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-2xl font-bold text-gray-600 dark:text-gray-300">{stats?.minor || 0}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Minor</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
          <p className="text-sm text-gray-500 dark:text-gray-400">Near Misses</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">
            {stats?.near_misses || 0}
          </p>
        </div>
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
          <p className="text-sm text-gray-500 dark:text-gray-400">DoL Reportable</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">
            {stats?.dol_reportable || 0}
          </p>
        </div>
        <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
          <p className="text-sm text-gray-500 dark:text-gray-400">CA Pending</p>
          <p className="text-xl font-semibold text-orange-500">{stats?.ca_pending || 0}</p>
        </div>
      </div>
    </div>
  );
}

function ContractorsAtRisk({ contractors }: { contractors?: any[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Contractors at Risk</h3>
        <a
          href="/contractors?hs_status=at_risk"
          className="text-sm text-orange-500 hover:text-orange-600 flex items-center gap-1"
        >
          View All <ChevronRight className="w-4 h-4" />
        </a>
      </div>

      {contractors && contractors.length > 0 ? (
        <div className="space-y-3">
          {contractors.slice(0, 5).map((c: any) => (
            <a
              key={c.id}
              href={`/contractors/${c.id}?tab=hs`}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{c.company_name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Score: {c.overall_score || 0}%
                </p>
              </div>
              <span
                className={`px-2 py-1 text-xs font-medium rounded ${
                  c.rag_status === 'red'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                }`}
              >
                {c.rag_status?.toUpperCase()}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
          <p className="text-gray-500 dark:text-gray-400">All contractors compliant</p>
        </div>
      )}
    </div>
  );
}

function UpcomingAudits({
  upcoming,
  overdue,
}: {
  upcoming?: any[];
  overdue?: any[];
}) {
  const combined = [
    ...(overdue || []).map((a: any) => ({ ...a, isOverdue: true })),
    ...(upcoming || []).filter((a: any) => !overdue?.find((o: any) => o.project_id === a.project_id)),
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Upcoming Audits</h3>
      </div>

      {combined.length > 0 ? (
        <div className="space-y-3">
          {combined.slice(0, 6).map((audit: any, idx: number) => (
            <a
              key={`${audit.project_id}-${idx}`}
              href={`/health-safety/project/${audit.project_id}/audits`}
              className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                audit.isOverdue
                  ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                  : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{audit.project_name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(audit.next_audit_due).toLocaleDateString()}
                  <span className="capitalize">• {audit.audit_frequency}</span>
                </p>
              </div>
              {audit.isOverdue ? (
                <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded">
                  Overdue
                </span>
              ) : audit.last_score !== null ? (
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  Last: {audit.last_score}%
                </span>
              ) : (
                <span className="text-sm text-gray-400">No audits yet</span>
              )}
            </a>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-500 dark:text-gray-400">No upcoming audits</p>
        </div>
      )}
    </div>
  );
}

function ProjectRAGDistribution({ ragStats }: { ragStats?: any }) {
  const total = (ragStats?.green || 0) + (ragStats?.amber || 0) + (ragStats?.red || 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Project Audit Status
      </h3>

      {total > 0 ? (
        <>
          {/* Bar chart */}
          <div className="flex h-8 rounded-lg overflow-hidden mb-4">
            {ragStats?.green > 0 && (
              <div
                className="bg-green-500"
                style={{ width: `${(ragStats.green / total) * 100}%` }}
              />
            )}
            {ragStats?.amber > 0 && (
              <div
                className="bg-amber-500"
                style={{ width: `${(ragStats.amber / total) * 100}%` }}
              />
            )}
            {ragStats?.red > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${(ragStats.red / total) * 100}%` }}
              />
            )}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-500" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Green: {ragStats?.green || 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-amber-500" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Amber: {ragStats?.amber || 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-red-500" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Red: {ragStats?.red || 0}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <Building2 className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-500 dark:text-gray-400">No audit data available</p>
        </div>
      )}
    </div>
  );
}

function RecentActivity({ activity }: { activity?: any[] }) {
  if (!activity || activity.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Activity</h3>

      <div className="space-y-3">
        {activity.slice(0, 10).map((item: any) => (
          <div
            key={item.id}
            className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
          >
            <div
              className={`p-1 rounded ${
                item.action === 'created'
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/30'
                  : item.action === 'deleted'
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30'
                    : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30'
              }`}
            >
              {item.action === 'created' ? (
                <CheckCircle className="w-4 h-4" />
              ) : item.action === 'deleted' ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <Clock className="w-4 h-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-900 dark:text-white">
                <span className="capitalize">{item.entity_type.replace(/_/g, ' ')}</span>{' '}
                <span className="font-medium">{item.action}</span>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(item.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

