/**
 * TeamReports - Team performance report section
 *
 * Reports:
 * - Technician Leaderboard
 * - Team Comparison
 * - Compliance Dashboard
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect } from 'react';
import { Trophy, Users, CheckCircle, Medal } from 'lucide-react';
import type {
  ReportFilters,
  TeamPerformanceResponse,
  TechnicianLeaderboardEntry,
  TeamComparisonEntry,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid, GaugeChart, TrendChart } from './shared';

interface TeamReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

type TeamSubReport = 'leaderboard' | 'teams' | 'compliance';

export function TeamReports({ filters, refreshKey }: TeamReportsProps) {
  const [activeSubReport, setActiveSubReport] = useState<TeamSubReport>('leaderboard');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TeamPerformanceResponse | null>(null);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        if (filters.project) params.set('project', filters.project);

        const res = await fetch(`/api/activate/reporting/team-performance?${params}`);
        if (!res.ok) throw new Error('Failed to fetch team performance data');

        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters, refreshKey]);

  const subReports: { id: TeamSubReport; label: string; icon: typeof Trophy }[] = [
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'teams', label: 'Team Comparison', icon: Users },
    { id: 'compliance', label: 'Compliance', icon: CheckCircle },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Sub-report tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-4">
        {subReports.map((sub) => {
          const Icon = sub.icon;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveSubReport(sub.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t text-sm font-medium transition-colors ${
                activeSubReport === sub.id
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-b-2 border-purple-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {sub.label}
            </button>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <ReportCardGrid columns={4}>
        <ReportCard
          title="Total Technicians"
          value={data?.summary?.total_technicians || 0}
          color="blue"
          icon={<Users className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <ReportCard
          title="Total Teams"
          value={data?.summary?.total_teams || 0}
          color="purple"
          isLoading={isLoading}
        />
        <ReportCard
          title="Avg First-Pass Rate"
          value={`${(data?.summary?.avg_first_pass_rate ?? 0).toFixed(1)}%`}
          color={
            (data?.summary?.avg_first_pass_rate || 0) >= 80
              ? 'green'
              : (data?.summary?.avg_first_pass_rate || 0) >= 60
                ? 'yellow'
                : 'red'
          }
          isLoading={isLoading}
        />
        <ReportCard
          title="Top Performer"
          value={data?.summary?.top_performer || '-'}
          color="cyan"
          icon={<Trophy className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </ReportCardGrid>

      {/* Content */}
      {activeSubReport === 'leaderboard' && (
        <LeaderboardSection data={data?.leaderboard || []} isLoading={isLoading} />
      )}
      {activeSubReport === 'teams' && (
        <TeamComparisonSection data={data?.teams || []} isLoading={isLoading} />
      )}
      {activeSubReport === 'compliance' && (
        <ComplianceSection data={data} isLoading={isLoading} />
      )}
    </div>
  );
}

// ============================================================================
// LEADERBOARD SECTION
// ============================================================================

function LeaderboardSection({
  data,
  isLoading,
}: {
  data: TechnicianLeaderboardEntry[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (data.length === 0) {
    return <EmptyState message="No technician data available" />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Rank
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Technician
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Project(s)
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Total
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              First-Pass %
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Resubmit %
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Serial %
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              7-Day Trend
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {data.map((entry, idx) => (
            <tr
              key={entry.sender_phone || idx}
              className={idx < 3 ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}
            >
              <td className="px-4 py-3 text-sm">
                <RankBadge rank={entry.rank} />
              </td>
              <td className="px-4 py-3 text-sm">
                <div className="font-medium text-gray-900 dark:text-white">
                  {entry.user_name || 'Unknown'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {entry.sender_phone ? entry.sender_phone.replace(/^27/, '0') : '-'}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                {entry.projects.join(', ') || '-'}
              </td>
              <td className="px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400">
                {entry.total_submissions}
              </td>
              <td className="px-4 py-3 text-sm">
                <RateCell value={entry.first_pass_rate} />
              </td>
              <td className="px-4 py-3 text-sm">
                <RateCell value={entry.resubmission_rate} invert />
              </td>
              <td className="px-4 py-3 text-sm">
                <RateCell value={entry.serial_compliance} />
              </td>
              <td className="px-4 py-3 text-sm">
                <MiniSparkline data={entry.trend_7d} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// TEAM COMPARISON SECTION
// ============================================================================

function TeamComparisonSection({
  data,
  isLoading,
}: {
  data: TeamComparisonEntry[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (data.length === 0) {
    return <EmptyState message="No team data available" />;
  }

  // Prepare data for chart
  const chartData = data.map((t) => ({
    team: t.team,
    'Total Activations': t.total_activations,
    'Matched to WA': t.matched_to_wa,
  }));

  return (
    <div className="space-y-6">
      {/* Bar Chart */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <TrendChart
          title="Team Activations Comparison"
          data={chartData}
          series={[
            { dataKey: 'Total Activations', name: 'Total Activations', color: '#8B5CF6' },
            { dataKey: 'Matched to WA', name: 'Matched to WA', color: '#10B981' },
          ]}
          type="bar"
          xAxisKey="team"
          height={250}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Team
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Project(s)
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Activations
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                WA Match %
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Avg Activation Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Avg ONT Signal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {data.map((team) => (
              <tr key={team.team}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                  {team.team}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {team.projects.join(', ') || '-'}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-purple-600 dark:text-purple-400">
                  {team.total_activations}
                </td>
                <td className="px-4 py-3 text-sm">
                  <RateCell value={team.wa_match_rate} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {team.avg_activation_time
                    ? `${team.avg_activation_time.toFixed(1)}h`
                    : '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  {team.avg_ont_signal ? (
                    <SignalStrength value={team.avg_ont_signal} />
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// COMPLIANCE SECTION
// ============================================================================

function ComplianceSection({
  data,
  isLoading,
}: {
  data: TeamPerformanceResponse | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!data?.compliance) {
    return <EmptyState message="No compliance data available" />;
  }

  const { compliance } = data;

  return (
    <div className="space-y-8">
      {/* Gauge Charts */}
      <div className="flex flex-wrap justify-center gap-8">
        <GaugeChart
          value={Math.round(compliance.wa_submission_compliance)}
          target={compliance.targets.wa_submission}
          label="WA Submission"
          color="auto"
          size="lg"
        />
        <GaugeChart
          value={Math.round(compliance.serial_scan_compliance)}
          target={compliance.targets.serial_scan}
          label="Serial Scanned"
          color="auto"
          size="lg"
        />
        <GaugeChart
          value={Math.round(compliance.photo_completion_compliance)}
          target={compliance.targets.photo_completion}
          label="Photo Completion"
          color="auto"
          size="lg"
        />
      </div>

      {/* Targets Legend */}
      <div className="flex justify-center gap-8 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-gray-600 dark:text-gray-400">Above target</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="text-gray-600 dark:text-gray-400">Near target (80%+)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-gray-600 dark:text-gray-400">Below target</span>
        </div>
      </div>

      {/* Compliance Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ComplianceCard
          title="WA Submission Compliance"
          description="Activated DRs that have WhatsApp submissions"
          value={compliance.wa_submission_compliance}
          target={compliance.targets.wa_submission}
        />
        <ComplianceCard
          title="Serial Scan Compliance"
          description="Submissions with ONT serial scanned"
          value={compliance.serial_scan_compliance}
          target={compliance.targets.serial_scan}
        />
        <ComplianceCard
          title="Photo Completion"
          description="Submissions with all 10 photo steps"
          value={compliance.photo_completion_compliance}
          target={compliance.targets.photo_completion}
        />
      </div>
    </div>
  );
}

function ComplianceCard({
  title,
  description,
  value,
  target,
}: {
  title: string;
  description: string;
  value: number;
  target: number;
}) {
  const isGood = value >= target;
  const isNear = value >= target * 0.8;

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
      <h4 className="font-medium text-gray-900 dark:text-white">{title}</h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      <div className="mt-3 flex items-end justify-between">
        <span
          className={`text-3xl font-bold ${
            isGood
              ? 'text-green-600 dark:text-green-400'
              : isNear
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400'
          }`}
        >
          {value.toFixed(1)}%
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Target: {target}%
        </span>
      </div>
      <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            isGood ? 'bg-green-500' : isNear ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    const colors = {
      1: 'bg-yellow-500 text-yellow-900',
      2: 'bg-gray-300 text-gray-700',
      3: 'bg-orange-400 text-orange-900',
    };
    return (
      <span
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${colors[rank as 1 | 2 | 3]} font-bold text-xs`}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="text-gray-600 dark:text-gray-400 font-medium">{rank}</span>
  );
}

function RateCell({ value, invert = false }: { value: number; invert?: boolean }) {
  const isGood = invert ? value <= 20 : value >= 80;
  const isNeutral = invert ? value <= 40 : value >= 60;

  return (
    <span
      className={`font-medium ${
        isGood
          ? 'text-green-600 dark:text-green-400'
          : isNeutral
            ? 'text-yellow-600 dark:text-yellow-400'
            : 'text-red-600 dark:text-red-400'
      }`}
    >
      {value.toFixed(1)}%
    </span>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  if (!data || data.length === 0) {
    return <span className="text-gray-400">-</span>;
  }

  const max = Math.max(...data, 1);
  const width = 60;
  const height = 20;

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        fill="none"
        stroke="#3B82F6"
        strokeWidth="1.5"
        points={data
          .map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`)
          .join(' ')}
      />
    </svg>
  );
}

function SignalStrength({ value }: { value: number }) {
  // ONT signal strength: good is around -20 to -25 dBm, bad is below -28
  const isGood = value >= -25;
  const isOkay = value >= -28;

  return (
    <span
      className={`font-mono ${
        isGood
          ? 'text-green-600 dark:text-green-400'
          : isOkay
            ? 'text-yellow-600 dark:text-yellow-400'
            : 'text-red-600 dark:text-red-400'
      }`}
    >
      {value.toFixed(1)} dBm
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
      <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>{message}</p>
    </div>
  );
}

export default TeamReports;
