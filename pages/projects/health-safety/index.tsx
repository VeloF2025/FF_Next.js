/**
 * Health & Safety Dashboard Page
 * /projects/health-safety - Main H&S overview with incidents, compliance, and audits
 */

import type { NextPage } from 'next';
import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Users,
  Calendar,
  ChevronRight,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function HealthSafetyContent() {
  const { data, error, isLoading } = useSWR('/api/health-safety/dashboard', fetcher);
  const dashboard = data?.data;

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load dashboard data</p>
        <p className="text-sm text-red-500 dark:text-red-300 mt-1">Please try refreshing the page</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link
          href="/projects/health-safety/incidents/new"
          className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          Report Incident
        </Link>
        <Link
          href="/projects/health-safety/checklists"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)] rounded-lg transition-colors border border-[var(--ff-border-light)]"
        >
          <FileText className="w-4 h-4" />
          Manage Checklists
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <OverallScoreCard
          score={dashboard?.overall?.score}
          ragStatus={dashboard?.overall?.rag_status}
          projectsConfigured={dashboard?.overall?.total_projects_configured}
        />
        <div className="md:col-span-3">
          <StatsGrid
            cards={[
              {
                title: 'Open Incidents',
                value: dashboard?.incidents?.stats?.open_incidents || 0,
                icon: AlertTriangle,
                color: '#EF4444',
                subtitle: `${dashboard?.incidents?.stats?.total_incidents || 0} total (12 months)`,
                description: 'Active safety incidents requiring attention',
                route: '/projects/health-safety/incidents',
                variant: 'detailed',
              },
              {
                title: 'Contractors Compliant',
                value: dashboard?.contractors?.by_rag?.green || 0,
                icon: Users,
                color: '#10B981',
                subtitle: `${dashboard?.contractors?.at_risk?.length || 0} at risk`,
                description: 'Contractors meeting safety requirements',
                route: '/contractors?hs_status=compliant',
                variant: 'detailed',
              },
              {
                title: 'Overdue Audits',
                value: dashboard?.audits?.overdue_count || 0,
                icon: Calendar,
                color: '#F97316',
                subtitle: `${dashboard?.audits?.upcoming?.length || 0} due soon`,
                description: 'Safety audits past their scheduled date',
                route: '/projects/health-safety/checklists',
                variant: 'detailed',
              },
            ] as EnhancedStatCardProps[]}
            columns={3}
          />
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Incidents Summary */}
        <div className="lg:col-span-2 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Incident Summary</h3>
            <Link
              href="/projects/health-safety/incidents"
              className="text-sm text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-600)] flex items-center gap-1"
            >
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            <SeverityCard label="Critical" value={dashboard?.incidents?.stats?.critical || 0} color="red" />
            <SeverityCard label="Major" value={dashboard?.incidents?.stats?.major || 0} color="orange" />
            <SeverityCard label="Moderate" value={dashboard?.incidents?.stats?.moderate || 0} color="yellow" />
            <SeverityCard label="Minor" value={dashboard?.incidents?.stats?.minor || 0} color="gray" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 border border-[var(--ff-border-light)] rounded-lg">
              <p className="text-sm text-[var(--ff-text-secondary)]">Near Misses</p>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
                {dashboard?.incidents?.stats?.near_misses || 0}
              </p>
            </div>
            <div className="p-3 border border-[var(--ff-border-light)] rounded-lg">
              <p className="text-sm text-[var(--ff-text-secondary)]">DoL Reportable</p>
              <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
                {dashboard?.incidents?.stats?.dol_reportable || 0}
              </p>
            </div>
            <div className="p-3 border border-[var(--ff-border-light)] rounded-lg">
              <p className="text-sm text-[var(--ff-text-secondary)]">CA Pending</p>
              <p className="text-xl font-semibold text-orange-500">
                {dashboard?.incidents?.stats?.ca_pending || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Contractors at Risk */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Contractors at Risk</h3>
            <Link
              href="/contractors?hs_status=at_risk"
              className="text-sm text-[var(--ff-primary-500)] hover:text-[var(--ff-primary-600)] flex items-center gap-1"
            >
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {dashboard?.contractors?.at_risk?.length > 0 ? (
            <div className="space-y-3">
              {dashboard.contractors.at_risk.slice(0, 5).map((c: any) => (
                <Link
                  key={c.id}
                  href={`/contractors/${c.id}?tab=hs`}
                  className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
                >
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">{c.company_name}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">
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
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
              <p className="text-[var(--ff-text-secondary)]">All contractors compliant</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-64 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
        <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse" />
      </div>
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

function SeverityCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'red' | 'orange' | 'yellow' | 'gray';
}) {
  const colors = {
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600',
    gray: 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300',
  };

  return (
    <div className={`text-center p-3 ${colors[color]} rounded-lg`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-[var(--ff-text-secondary)]">{label}</p>
    </div>
  );
}

const HealthSafetyPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>Health & Safety | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        <HealthSafetyContent />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps = async () => {
  return { props: {} };
};

export default HealthSafetyPage;
