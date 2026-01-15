/**
 * Fleet Driver Scorecard Tab
 * Detailed view of a driver's performance metrics
 */

import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  User,
  Car,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Fuel,
  Shield,
  Wrench,
  ArrowLeft,
  Phone,
  Mail,
  Calendar,
  AlertTriangle,
  Search,
} from 'lucide-react';
import type { DriverScorecard, ScorePeriod } from '@/modules/fleet/types/driver-score.types';
import { getScoreColor, getScoreLabel, getRankBadge } from '@/modules/fleet/types/driver-score.types';
import type { FleetDriver } from '@/modules/fleet/types/driver.types';

interface ScorecardTabProps {
  staffId: string | null;
  drivers: FleetDriver[];
  onSelectDriver: (staffId: string | null) => void;
}

function ScoreGauge({ score, label, icon: Icon, description, trend, trendValue }: {
  score: number | null;
  label: string;
  icon: React.ElementType;
  description: string;
  trend: 'up' | 'down' | 'flat' | null;
  trendValue: number | null;
}) {
  const color = getScoreColor(score);
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - ((score ?? 0) / 100) * circumference;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-[var(--ff-primary)]" />
          <h3 className="font-semibold text-[var(--ff-text-primary)]">{label}</h3>
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-sm ${
            trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-500'
          }`}>
            {trend === 'up' ? <TrendingUp className="w-4 h-4" /> : trend === 'down' ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
            {trendValue !== null && <span>{trendValue > 0 ? '+' : ''}{trendValue.toFixed(1)}</span>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center mb-4 relative">
        <svg className="w-32 h-32 transform -rotate-90">
          <circle cx="64" cy="64" r="45" fill="none" stroke="var(--ff-bg-tertiary)" strokeWidth="10" />
          <circle
            cx="64"
            cy="64"
            r="45"
            fill="none"
            stroke={score === null ? 'var(--ff-text-tertiary)' : score >= 70 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444'}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className={`text-3xl font-bold ${color}`}>
            {score !== null ? Math.round(score) : '-'}
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)]">/ 100</div>
        </div>
      </div>

      <p className="text-xs text-[var(--ff-text-tertiary)] text-center">{description}</p>
      <p className="text-sm text-center mt-2 font-medium text-[var(--ff-text-secondary)]">
        {getScoreLabel(score)}
      </p>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
      <Icon className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
      <div>
        <p className="text-xs text-[var(--ff-text-tertiary)]">{label}</p>
        <p className="font-medium text-[var(--ff-text-primary)]">{value}</p>
      </div>
    </div>
  );
}

function DriverPicker({ drivers, onSelect }: { drivers: FleetDriver[]; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState('');

  const filtered = drivers.filter((d) => {
    if (!search) return d.status === 'ACTIVE';
    const term = search.toLowerCase();
    return d.name.toLowerCase().includes(term);
  });

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Select a Driver</h2>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
        <input
          type="text"
          placeholder="Search drivers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
        {filtered.map((driver) => (
          <button
            key={driver.staffId}
            onClick={() => onSelect(driver.staffId)}
            className="flex items-center gap-3 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-primary)]/10 transition-colors text-left"
          >
            {driver.photoUrl ? (
              <img src={driver.photoUrl} alt={driver.name} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--ff-primary)] flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--ff-text-primary)] truncate">{driver.name}</p>
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {driver.compositeScore !== null ? `Score: ${Math.round(driver.compositeScore)}` : 'No score'}
              </p>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-center text-[var(--ff-text-tertiary)] py-4">No drivers found</p>
        )}
      </div>
    </div>
  );
}

function ScorecardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 bg-[var(--ff-bg-tertiary)] rounded-full"></div>
          <div className="flex-1">
            <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-2"></div>
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-32"></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] h-64"></div>
        ))}
      </div>
    </div>
  );
}

export function ScorecardTab({ staffId, drivers, onSelectDriver }: ScorecardTabProps) {
  const [scorecard, setScorecard] = useState<DriverScorecard | null>(null);
  const [period, setPeriod] = useState<ScorePeriod>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!staffId) {
      setScorecard(null);
      return;
    }

    async function fetchScorecard() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/fleet/drivers/${staffId}/scorecard?period=${period}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Driver not found');
          throw new Error('Failed to fetch scorecard');
        }
        const data = await res.json();
        setScorecard(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scorecard');
      } finally {
        setLoading(false);
      }
    }

    fetchScorecard();
  }, [staffId, period]);

  // No driver selected - show picker
  if (!staffId) {
    return <DriverPicker drivers={drivers} onSelect={onSelectDriver} />;
  }

  // Loading
  if (loading) {
    return <ScorecardSkeleton />;
  }

  // Error
  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-2">{error}</h2>
        <button
          onClick={() => onSelectDriver(null)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Driver Selection
        </button>
      </div>
    );
  }

  if (!scorecard) return null;

  const rankBadge = scorecard.currentRank ? getRankBadge(scorecard.currentRank) : null;

  const chartData = scorecard.scoreHistory.map((point) => ({
    period: point.scoreDate.substring(0, 7),
    Composite: point.compositeScore,
    'Check-in': point.checkInCompliance,
    Fuel: point.fuelEfficiencyScore,
    Authorization: point.authorizationCompliance,
    'Vehicle Care': point.vehicleCareScore,
  })).reverse();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => onSelectDriver(null)}
          className="p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-[var(--ff-text-primary)]">Driver Scorecard</h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">Detailed performance metrics</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as ScorePeriod)}
          className="px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {/* Driver Info */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-[var(--ff-primary)] flex items-center justify-center flex-shrink-0">
            <User className="w-10 h-10 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-[var(--ff-text-primary)] mb-1">{scorecard.driverName}</h3>
            <div className="flex flex-wrap gap-4 text-sm text-[var(--ff-text-secondary)]">
              {scorecard.driverPhone && (
                <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{scorecard.driverPhone}</span>
              )}
              {scorecard.driverEmail && (
                <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{scorecard.driverEmail}</span>
              )}
            </div>
            {scorecard.assignedVehicle && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Car className="w-4 h-4 text-[var(--ff-primary)]" />
                <span className="font-medium">{scorecard.assignedVehicle.registration}</span>
                <span className="text-[var(--ff-text-tertiary)]">
                  {scorecard.assignedVehicle.make} {scorecard.assignedVehicle.model}
                </span>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 text-center">
            <div className={`text-4xl font-bold ${getScoreColor(scorecard.currentScore?.compositeScore ?? null)}`}>
              {scorecard.currentScore?.compositeScore !== null ? Math.round(scorecard.currentScore?.compositeScore ?? 0) : '-'}
            </div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">{getScoreLabel(scorecard.currentScore?.compositeScore ?? null)}</p>
            {scorecard.currentRank && rankBadge && (
              <div className="mt-2 flex items-center justify-center gap-1">
                {rankBadge.icon && <span className="text-lg">{rankBadge.icon}</span>}
                <span className={`font-bold ${rankBadge.color}`}>#{scorecard.currentRank}</span>
                <span className="text-xs text-[var(--ff-text-tertiary)]">of {scorecard.totalDrivers}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ScoreGauge
          score={scorecard.breakdown.checkIn.score}
          label="Check-in Compliance"
          icon={CheckCircle2}
          description={scorecard.breakdown.checkIn.description}
          trend={scorecard.breakdown.checkIn.trend}
          trendValue={scorecard.breakdown.checkIn.trendValue}
        />
        <ScoreGauge
          score={scorecard.breakdown.fuelEfficiency.score}
          label="Fuel Efficiency"
          icon={Fuel}
          description={scorecard.breakdown.fuelEfficiency.description}
          trend={scorecard.breakdown.fuelEfficiency.trend}
          trendValue={scorecard.breakdown.fuelEfficiency.trendValue}
        />
        <ScoreGauge
          score={scorecard.breakdown.authorization.score}
          label="Authorization"
          icon={Shield}
          description={scorecard.breakdown.authorization.description}
          trend={scorecard.breakdown.authorization.trend}
          trendValue={scorecard.breakdown.authorization.trendValue}
        />
        <ScoreGauge
          score={scorecard.breakdown.vehicleCare.score}
          label="Vehicle Care"
          icon={Wrench}
          description={scorecard.breakdown.vehicleCare.description}
          trend={scorecard.breakdown.vehicleCare.trend}
          trendValue={scorecard.breakdown.vehicleCare.trendValue}
        />
      </div>

      {/* Metrics Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        <MetricCard
          label="Total Check-ins"
          value={`${scorecard.breakdown.checkIn.metrics.totalCheckIns}/${scorecard.breakdown.checkIn.metrics.expectedCheckIns}`}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Late Check-ins"
          value={scorecard.breakdown.checkIn.metrics.lateCheckIns as number}
          icon={Calendar}
        />
        <MetricCard
          label="Total Trips"
          value={scorecard.breakdown.authorization.metrics.totalTrips as number}
          icon={Car}
        />
        <MetricCard
          label="Unauthorized"
          value={scorecard.breakdown.authorization.metrics.unauthorizedTrips as number}
          icon={AlertTriangle}
        />
        <MetricCard
          label="Fuel Consumption"
          value={scorecard.breakdown.fuelEfficiency.metrics.avgLitresPer100km !== 'N/A'
            ? `${scorecard.breakdown.fuelEfficiency.metrics.avgLitresPer100km} L/100km`
            : 'N/A'}
          icon={Fuel}
        />
        <MetricCard
          label="Fleet Average"
          value={scorecard.breakdown.fuelEfficiency.metrics.fleetAvgLitresPer100km !== 'N/A'
            ? `${scorecard.breakdown.fuelEfficiency.metrics.fleetAvgLitresPer100km} L/100km`
            : 'N/A'}
          icon={TrendingUp}
        />
      </div>

      {/* Score History Chart */}
      {chartData.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Score History</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
                <XAxis dataKey="period" tick={{ fill: 'var(--ff-text-secondary)' }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--ff-text-secondary)' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--ff-bg-secondary)',
                    border: '1px solid var(--ff-border-light)',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="Composite" stroke="#8B5CF6" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Check-in" stroke="#10B981" strokeWidth={1} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="Fuel" stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="Authorization" stroke="#3B82F6" strokeWidth={1} strokeDasharray="3 3" />
                <Line type="monotone" dataKey="Vehicle Care" stroke="#EC4899" strokeWidth={1} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {chartData.length === 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] text-center">
          <Trophy className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Score History Yet</h3>
          <p className="text-[var(--ff-text-secondary)]">
            Score history will appear here as scores are calculated over time.
          </p>
        </div>
      )}
    </div>
  );
}
