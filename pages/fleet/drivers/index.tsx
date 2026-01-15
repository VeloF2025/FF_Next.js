/**
 * Fleet Driver Leaderboard Page
 * Shows driver performance rankings and scorecards
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { notificationService } from '@/services/core/NotificationService';
import {
  Trophy,
  Medal,
  Star,
  TrendingUp,
  TrendingDown,
  User,
  Car,
  Fuel,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import type { Leaderboard, LeaderboardEntry, ScorePeriod } from '@/modules/fleet/types/driver-score.types';
import { getScoreColor, getScoreLabel, getRankBadge } from '@/modules/fleet/types/driver-score.types';

function formatNumber(num: number | null, decimals = 0): string {
  if (num === null) return 'N/A';
  return num.toLocaleString('en-ZA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Score bar component
function ScoreBar({ score, label }: { score: number | null; label: string }) {
  const color = score === null ? 'bg-gray-400' : score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--ff-text-tertiary)] w-24 truncate">{label}</span>
      <div className="flex-1 h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
      <span className="text-xs font-medium w-10 text-right">{score !== null ? Math.round(score) : '-'}</span>
    </div>
  );
}

// Leaderboard row component
function LeaderboardRow({ entry, onViewScorecard }: { entry: LeaderboardEntry; onViewScorecard: () => void }) {
  const rankBadge = getRankBadge(entry.rank);

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors">
      <div className="flex items-start gap-4">
        {/* Rank */}
        <div className="flex-shrink-0 w-12 text-center">
          {entry.rank <= 3 ? (
            <span className="text-2xl">{rankBadge.icon}</span>
          ) : (
            <span className={`text-2xl font-bold ${rankBadge.color}`}>#{entry.rank}</span>
          )}
        </div>

        {/* Driver Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <span className="font-medium text-[var(--ff-text-primary)] truncate">{entry.driverName}</span>
          </div>
          {entry.driverPhone && (
            <p className="text-xs text-[var(--ff-text-tertiary)]">{entry.driverPhone}</p>
          )}
        </div>

        {/* Composite Score */}
        <div className="flex-shrink-0 text-center">
          <div className={`text-3xl font-bold ${getScoreColor(entry.compositeScore)}`}>
            {entry.compositeScore !== null ? Math.round(entry.compositeScore) : '-'}
          </div>
          <p className="text-xs text-[var(--ff-text-tertiary)]">{getScoreLabel(entry.compositeScore)}</p>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <ScoreBar score={entry.checkInCompliance} label="Check-in" />
        <ScoreBar score={entry.fuelEfficiencyScore} label="Fuel Eff." />
        <ScoreBar score={entry.authorizationCompliance} label="Authorization" />
        <ScoreBar score={entry.vehicleCareScore} label="Vehicle Care" />
      </div>

      {/* Stats Row */}
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--ff-text-tertiary)]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {entry.totalCheckIns}/{entry.expectedCheckIns} checks
          </span>
          <span className="flex items-center gap-1">
            <Car className="w-3 h-3" />
            {entry.totalTrips} trips
          </span>
          {entry.avgLitresPer100km && (
            <span className="flex items-center gap-1">
              <Fuel className="w-3 h-3" />
              {entry.avgLitresPer100km.toFixed(1)} L/100km
            </span>
          )}
        </div>
        <button
          onClick={onViewScorecard}
          className="flex items-center gap-1 text-[var(--ff-primary)] hover:underline"
        >
          View Scorecard
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// Loading skeleton
function LeaderboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[var(--ff-bg-tertiary)] rounded-full"></div>
            <div className="flex-1">
              <div className="h-5 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-2"></div>
              <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-24"></div>
            </div>
            <div className="w-16 h-12 bg-[var(--ff-bg-tertiary)] rounded"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DriverLeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [period, setPeriod] = useState<ScorePeriod>('monthly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Fetch leaderboard
  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/fleet/drivers/leaderboard?period=${period}&limit=20`);
        if (!res.ok) throw new Error('Failed to fetch leaderboard');
        const data = await res.json();
        setLeaderboard(data.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load leaderboard';
        setError(message);
        notificationService.error(`Failed to load leaderboard: ${message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
  }, [period]);

  // Calculate scores
  const handleCalculateScores = async () => {
    setCalculating(true);
    try {
      const res = await fetch('/api/fleet/drivers/calculate-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      });

      if (!res.ok) throw new Error('Failed to calculate scores');

      const data = await res.json();
      const count = data.data.count;

      if (count === 0) {
        notificationService.info('No drivers with activity found for this period');
      } else if (count === 1) {
        notificationService.success('Calculated score for 1 driver');
      } else {
        notificationService.success(`Calculated scores for ${count} drivers`);
      }

      // Refresh leaderboard
      const refreshRes = await fetch(`/api/fleet/drivers/leaderboard?period=${period}&limit=20`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setLeaderboard(refreshData.data);
      }
    } catch {
      notificationService.error('Failed to calculate scores. Please try again.');
    } finally {
      setCalculating(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Trophy className="w-7 h-7 text-yellow-500" />
              Driver Leaderboard
            </h1>
            <p className="text-[var(--ff-text-secondary)]">
              Performance rankings based on check-ins, fuel efficiency, authorization, and vehicle care
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as ScorePeriod)}
              className="px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <button
              onClick={handleCalculateScores}
              disabled={calculating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-hover)] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${calculating ? 'animate-spin' : ''}`} />
              {calculating ? 'Calculating...' : 'Recalculate'}
            </button>
          </div>
        </div>

        {/* Stats Summary */}
        {leaderboard && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                <User className="w-4 h-4" />
                <span className="text-sm">Total Drivers</span>
              </div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{leaderboard.totalDrivers}</p>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                <Medal className="w-4 h-4 text-yellow-500" />
                <span className="text-sm">Top Performer</span>
              </div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {leaderboard.entries[0]?.driverName || '-'}
              </p>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                <Star className="w-4 h-4 text-green-500" />
                <span className="text-sm">Highest Score</span>
              </div>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {leaderboard.entries[0]?.compositeScore
                  ? Math.round(leaderboard.entries[0].compositeScore)
                  : '-'}
              </p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && <LeaderboardSkeleton />}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-2">
              Failed to Load Leaderboard
            </h2>
            <p className="text-red-600 dark:text-red-300 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && leaderboard?.entries.length === 0 && (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-8 border border-[var(--ff-border-light)] text-center">
            <Trophy className="w-16 h-16 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
              No Driver Scores Yet
            </h2>
            <p className="text-[var(--ff-text-secondary)] mb-4">
              Click &quot;Recalculate&quot; to generate driver performance scores based on their activity.
            </p>
            <button
              onClick={handleCalculateScores}
              disabled={calculating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-hover)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${calculating ? 'animate-spin' : ''}`} />
              Calculate Scores
            </button>
          </div>
        )}

        {/* Leaderboard List */}
        {!loading && !error && leaderboard && leaderboard.entries.length > 0 && (
          <div className="space-y-4">
            {leaderboard.entries.map((entry) => (
              <LeaderboardRow
                key={entry.staffId}
                entry={entry}
                onViewScorecard={() => {
                  window.location.href = `/fleet/drivers/${entry.staffId}`;
                }}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        {leaderboard && (
          <div className="text-center text-sm text-[var(--ff-text-tertiary)]">
            Last updated: {new Date(leaderboard.generatedAt).toLocaleString()}
            {leaderboard.scoreDate && ` • Score date: ${leaderboard.scoreDate}`}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
