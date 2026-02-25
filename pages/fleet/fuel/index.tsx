/**
 * Fleet Fuel Analytics Page
 * Fuel consumption, costs, efficiency, and anomaly detection
 */

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import { notificationService } from '@/services/core/NotificationService';
import {
  Fuel,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Car,
  Gauge,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import type {
  FleetFuelSummary,
  VehicleFuelStats,
  FuelAnomalyWithVehicle,
} from '@/modules/fleet/types/fuel-analytics.types';
import {
  formatCurrency,
  formatEfficiency,
  getAnomalySeverityColor,
  getAnomalySeverityBgColor,
  getAnomalyTypeLabel,
  getAnomalyStatusColor,
} from '@/modules/fleet/types/fuel-analytics.types';

type Period = 'week' | 'month' | 'quarter' | 'year';

// KPI Card Component
function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  color = 'blue',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: number | null;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}) {
  const colorClasses = {
    blue: 'text-blue-500',
    green: 'text-green-500',
    yellow: 'text-yellow-500',
    red: 'text-red-500',
    purple: 'text-purple-500',
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-2">
        <Icon className={`w-4 h-4 ${colorClasses[color]}`} />
        <span className="text-sm">{title}</span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</p>
          {subtitle && (
            <p className="text-xs text-[var(--ff-text-tertiary)]">{subtitle}</p>
          )}
        </div>
        {trend && trendValue !== null && trendValue !== undefined && (
          <div className={`flex items-center gap-1 text-sm ${
            trend === 'up' ? 'text-red-500' : trend === 'down' ? 'text-green-500' : 'text-gray-500'
          }`}>
            {trend === 'up' ? <TrendingUp className="w-4 h-4" /> :
             trend === 'down' ? <TrendingDown className="w-4 h-4" /> : null}
            <span>{Math.abs(trendValue).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Vehicle Efficiency Card
function VehicleEfficiencyCard({ vehicle }: { vehicle: VehicleFuelStats }) {
  const isAboveAverage = vehicle.vsFleetAvg > 0;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-[var(--ff-text-primary)]">{vehicle.registration}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)]">
            {vehicle.make} {vehicle.model}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold ${
            vehicle.avgLitresPer100km <= 10 ? 'text-green-500' :
            vehicle.avgLitresPer100km <= 15 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {vehicle.avgLitresPer100km.toFixed(1)}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)]">L/100km</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--ff-text-tertiary)]">
          {vehicle.driverName || 'Unassigned'}
        </span>
        <span className={isAboveAverage ? 'text-red-500' : 'text-green-500'}>
          {isAboveAverage ? '+' : ''}{vehicle.vsFleetAvg.toFixed(0)}% vs fleet
        </span>
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--ff-text-tertiary)]">
        <span>{formatCurrency(vehicle.totalCost)}</span>
        <span>{vehicle.fillCount} fills</span>
        <span>{vehicle.totalKm.toFixed(0)} km</span>
      </div>
    </div>
  );
}

// Anomaly Alert Card
function AnomalyCard({
  anomaly,
  onUpdateStatus
}: {
  anomaly: FuelAnomalyWithVehicle;
  onUpdateStatus: (id: string, status: string) => void;
}) {
  return (
    <div className={`rounded-lg p-4 border ${getAnomalySeverityBgColor(anomaly.severity)} border-[var(--ff-border-light)]`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-4 h-4 ${getAnomalySeverityColor(anomaly.severity)}`} />
          <span className={`text-sm font-medium ${getAnomalySeverityColor(anomaly.severity)}`}>
            {getAnomalyTypeLabel(anomaly.anomalyType)}
          </span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${getAnomalyStatusColor(anomaly.status)} bg-[var(--ff-bg-tertiary)]`}>
          {anomaly.status}
        </span>
      </div>

      <p className="text-sm text-[var(--ff-text-primary)] mb-2">
        {anomaly.registration} - {anomaly.make} {anomaly.model}
      </p>

      {anomaly.deviationPercentage && (
        <p className="text-xs text-[var(--ff-text-secondary)] mb-2">
          Deviation: {anomaly.deviationPercentage.toFixed(1)}%
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          {new Date(anomaly.detectedAt).toLocaleDateString()}
        </span>
        {anomaly.status === 'detected' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdateStatus(anomaly.id, 'investigating')}
              className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-600 rounded hover:bg-yellow-500/30 flex items-center gap-1"
            >
              <Clock className="w-3 h-3" />
              Investigate
            </button>
            <button
              onClick={() => onUpdateStatus(anomaly.id, 'dismissed')}
              className="text-xs px-2 py-1 bg-gray-500/20 text-gray-600 rounded hover:bg-gray-500/30 flex items-center gap-1"
            >
              <XCircle className="w-3 h-3" />
              Dismiss
            </button>
          </div>
        )}
        {anomaly.status === 'investigating' && (
          <button
            onClick={() => onUpdateStatus(anomaly.id, 'resolved')}
            className="text-xs px-2 py-1 bg-green-500/20 text-green-600 rounded hover:bg-green-500/30 flex items-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" />
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}

// Loading skeleton
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] h-80" />
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] h-80" />
      </div>
    </div>
  );
}

export default function FuelAnalyticsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<FleetFuelSummary | null>(null);
  const [vehicleStats, setVehicleStats] = useState<VehicleFuelStats[]>([]);
  const [anomalies, setAnomalies] = useState<FuelAnomalyWithVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detectingAnomalies, setDetectingAnomalies] = useState(false);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [summaryRes, vehiclesRes] = await Promise.all([
          fetch(`/api/fleet/fuel/summary?period=${period}`),
          fetch(`/api/fleet/fuel/vehicles?period=${period}`),
        ]);

        if (!summaryRes.ok || !vehiclesRes.ok) {
          throw new Error('Failed to fetch fuel data');
        }

        const [summaryData, vehiclesData] = await Promise.all([
          summaryRes.json(),
          vehiclesRes.json(),
        ]);

        setSummary(summaryData.data);
        setVehicleStats(vehiclesData.data || []);

        // Anomalies are non-critical — don't block the page if they fail
        try {
          const anomaliesRes = await fetch(`/api/fleet/fuel/anomalies?status=detected&limit=10`);
          if (anomaliesRes.ok) {
            const anomaliesData = await anomaliesRes.json();
            setAnomalies(anomaliesData.data?.anomalies || []);
          }
        } catch { /* anomalies are supplementary */ }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
        notificationService.error(`Failed to load fuel analytics: ${message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [period]);

  // Run anomaly detection
  const handleDetectAnomalies = async () => {
    setDetectingAnomalies(true);
    try {
      const res = await fetch('/api/fleet/fuel/anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 30 }),
      });

      if (!res.ok) throw new Error('Failed to run detection');

      const data = await res.json();
      const count = data.data.anomalies.length;

      if (count === 0) {
        notificationService.success('No anomalies detected - all fuel transactions look normal');
      } else if (count === 1) {
        notificationService.warning(`1 fuel anomaly detected - review required`);
      } else {
        notificationService.warning(`${count} fuel anomalies detected - review required`);
      }

      // Refresh anomalies list
      const anomaliesRes = await fetch('/api/fleet/fuel/anomalies?status=detected&limit=10');
      if (anomaliesRes.ok) {
        const anomaliesData = await anomaliesRes.json();
        setAnomalies(anomaliesData.data?.anomalies || []);
      }
    } catch (err) {
      notificationService.error('Failed to run anomaly detection. Please try again.');
    } finally {
      setDetectingAnomalies(false);
    }
  };

  // Update anomaly status
  const handleUpdateAnomalyStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/fleet/fuel/anomalies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) throw new Error('Failed to update status');

      // Remove from list if resolved/dismissed
      if (status === 'resolved' || status === 'dismissed') {
        setAnomalies(prev => prev.filter(a => a.id !== id));
        notificationService.success(
          status === 'resolved'
            ? 'Anomaly marked as resolved'
            : 'Anomaly dismissed'
        );
      } else {
        // Update in place
        setAnomalies(prev => prev.map(a =>
          a.id === id ? { ...a, status: status as FuelAnomalyWithVehicle['status'] } : a
        ));
        notificationService.info('Anomaly marked for investigation');
      }
    } catch {
      notificationService.error('Failed to update anomaly status');
    }
  };

  return (
    <AppLayout>
        <ModulePage config={fleetConfig}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Fuel className="w-7 h-7 text-blue-500" />
              Fuel Analytics
            </h1>
            <p className="text-[var(--ff-text-secondary)]">
              Fuel consumption, costs, and efficiency monitoring
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
            >
              <option value="week">Last Week</option>
              <option value="month">Last Month</option>
              <option value="quarter">Last Quarter</option>
              <option value="year">Last Year</option>
            </select>
            <button
              onClick={handleDetectAnomalies}
              disabled={detectingAnomalies}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              <AlertTriangle className={`w-4 h-4 ${detectingAnomalies ? 'animate-pulse' : ''}`} />
              {detectingAnomalies ? 'Detecting...' : 'Detect Anomalies'}
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading && <LoadingSkeleton />}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-2">
              Failed to Load Data
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

        {/* Main Content */}
        {!loading && !error && summary && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Total Fuel Cost"
                value={formatCurrency(summary.totalCost)}
                subtitle={`${summary.vehiclesWithFuelData} vehicles`}
                icon={DollarSign}
                trend={summary.costTrend}
                trendValue={summary.costTrendValue}
                color="green"
              />
              <KPICard
                title="Total Litres"
                value={`${summary.totalLitres.toFixed(0)} L`}
                subtitle={`${summary.totalKmDriven.toFixed(0)} km driven`}
                icon={Fuel}
                color="blue"
              />
              <KPICard
                title="Avg Efficiency"
                value={formatEfficiency(summary.avgLitresPer100km)}
                subtitle={`Best: ${formatEfficiency(summary.bestLitresPer100km)}`}
                icon={Gauge}
                trend={summary.efficiencyTrend}
                trendValue={summary.efficiencyTrendValue}
                color="purple"
              />
              <KPICard
                title="Anomalies"
                value={summary.unresolvedAnomalies}
                subtitle={summary.criticalAnomalies > 0 ? `${summary.criticalAnomalies} critical` : 'No critical'}
                icon={AlertTriangle}
                color={summary.criticalAnomalies > 0 ? 'red' : 'yellow'}
              />
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Vehicle Efficiency Rankings */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                  <h2 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                    <Car className="w-5 h-5 text-blue-500" />
                    Vehicle Efficiency Rankings
                  </h2>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">
                    Best to worst
                  </span>
                </div>
                <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                  {vehicleStats.length === 0 ? (
                    <p className="text-center text-[var(--ff-text-tertiary)] py-8">
                      No fuel data available for this period
                    </p>
                  ) : (
                    vehicleStats.map((vehicle) => (
                      <VehicleEfficiencyCard key={vehicle.vehicleId} vehicle={vehicle} />
                    ))
                  )}
                </div>
              </div>

              {/* Anomaly Alerts */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                <div className="p-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
                  <h2 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    Active Anomalies
                  </h2>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">
                    {anomalies.length} detected
                  </span>
                </div>
                <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                  {anomalies.length === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
                      <p className="text-[var(--ff-text-tertiary)]">
                        No active anomalies detected
                      </p>
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                        Click &quot;Detect Anomalies&quot; to run analysis
                      </p>
                    </div>
                  ) : (
                    anomalies.map((anomaly) => (
                      <AnomalyCard
                        key={anomaly.id}
                        anomaly={anomaly}
                        onUpdateStatus={handleUpdateAnomalyStatus}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Cost Breakdown Summary */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
              <h2 className="font-semibold text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                Cost Analysis
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    R{(summary.avgCostPerKm * 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">per 100km</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    R{summary.avgPricePerLitre.toFixed(2)}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">avg price/L</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {summary.totalVehicles}
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">total vehicles</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {((summary.vehiclesWithFuelData / summary.totalVehicles) * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">with fuel data</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </ModulePage>
      </AppLayout>
  );
}
