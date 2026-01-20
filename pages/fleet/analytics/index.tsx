/**
 * Fleet Analytics Dashboard
 * KPI overview, TCO breakdown, cost trends, and compliance metrics
 */

import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { notificationService } from '@/services/core/NotificationService';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Fuel,
  Wrench,
  Users,
  AlertTriangle,
  CheckCircle2,
  Car,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import type { FleetKPIs, TCOReport, CostTrendReport } from '@/modules/fleet/types/analytics.types';

const COLORS = {
  primary: '#8B5CF6',
  secondary: '#06B6D4',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  fuel: '#F97316',
  service: '#EC4899',
  lease: '#8B5CF6',
  insurance: '#06B6D4',
  license: '#84CC16',
};

const PIE_COLORS = [
  COLORS.fuel,
  COLORS.service,
  COLORS.lease,
  COLORS.insurance,
  COLORS.license,
];

function formatCurrency(amount: number): string {
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatNumber(num: number, decimals = 0): string {
  return num.toLocaleString('en-ZA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Loading skeleton component
function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-24 mb-2"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-20"></div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] h-80">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4"></div>
          <div className="h-full bg-[var(--ff-bg-tertiary)] rounded"></div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] h-80">
          <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded w-32 mb-4"></div>
          <div className="h-full bg-[var(--ff-bg-tertiary)] rounded"></div>
        </div>
      </div>
    </div>
  );
}

// KPI Card component
function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  trend?: { value: number; isPositive: boolean } | null;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-[var(--ff-text-secondary)] mb-1">{title}</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</p>
          {subtitle && (
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{subtitle}</p>
          )}
          {trend && trend.value !== 0 && (
            <div className={`flex items-center mt-2 text-xs ${trend.isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {trend.isPositive ? (
                <TrendingUp className="w-3 h-3 mr-1" />
              ) : (
                <TrendingDown className="w-3 h-3 mr-1" />
              )}
              {Math.abs(trend.value).toFixed(1)}% vs last period
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

// Alert Card component
function AlertCard({
  title,
  count,
  type,
  href,
}: {
  title: string;
  count: number;
  type: 'warning' | 'error' | 'info';
  href?: string;
}) {
  const colors = {
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
    error: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
    info: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  };

  const icons = {
    warning: AlertTriangle,
    error: AlertTriangle,
    info: CheckCircle2,
  };

  const Icon = icons[type];

  return (
    <div className={`rounded-lg p-4 border ${colors[type]} flex items-center justify-between`}>
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5" />
        <span className="font-medium">{title}</span>
      </div>
      <span className="text-xl font-bold">{count}</span>
    </div>
  );
}

export default function FleetAnalyticsPage() {
  const [kpis, setKpis] = useState<FleetKPIs | null>(null);
  const [tcoReport, setTcoReport] = useState<TCOReport | null>(null);
  const [costTrends, setCostTrends] = useState<CostTrendReport | null>(null);
  const [tcoPeriod, setTcoPeriod] = useState<'12m' | 'lifetime'>('12m');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [kpisRes, tcoRes, trendsRes] = await Promise.all([
          fetch('/api/fleet/analytics'),
          fetch(`/api/fleet/analytics/tco?period=${tcoPeriod}`),
          fetch('/api/fleet/analytics/cost-trends?period=monthly&months=12'),
        ]);

        if (!kpisRes.ok || !tcoRes.ok || !trendsRes.ok) {
          throw new Error('Failed to fetch analytics data');
        }

        const [kpisData, tcoData, trendsData] = await Promise.all([
          kpisRes.json(),
          tcoRes.json(),
          trendsRes.json(),
        ]);

        setKpis(kpisData.data);
        setTcoReport(tcoData.data);
        setCostTrends(trendsData.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load analytics';
        setError(message);
        notificationService.error(`Failed to load analytics: ${message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [tcoPeriod]);

  // Prepare chart data
  const costBreakdownData = useMemo(() => {
    if (!tcoReport) return [];

    return [
      { name: 'Fuel', value: tcoReport.costBreakdown.fuel, color: COLORS.fuel },
      { name: 'Service', value: tcoReport.costBreakdown.service, color: COLORS.service },
      { name: 'Lease', value: tcoReport.costBreakdown.lease, color: COLORS.lease },
      { name: 'Insurance', value: tcoReport.costBreakdown.insurance, color: COLORS.insurance },
      { name: 'License', value: tcoReport.costBreakdown.license, color: COLORS.license },
    ].filter(item => item.value > 0);
  }, [tcoReport]);

  const ownershipData = useMemo(() => {
    if (!tcoReport) return [];

    return [
      { name: 'Company', count: tcoReport.byOwnershipType.company.count, tco: tcoReport.byOwnershipType.company.totalTCO },
      { name: 'Leased', count: tcoReport.byOwnershipType.leased.count, tco: tcoReport.byOwnershipType.leased.totalTCO },
      { name: 'Rental', count: tcoReport.byOwnershipType.rental.count, tco: tcoReport.byOwnershipType.rental.totalTCO },
    ].filter(item => item.count > 0);
  }, [tcoReport]);

  const trendChartData = useMemo(() => {
    if (!costTrends) return [];

    return costTrends.dataPoints.map(point => ({
      period: point.period,
      fuel: point.fuelCost,
      maintenance: point.maintenanceCost,
      total: point.totalCost,
      costPerKm: point.costPerKm,
    }));
  }, [costTrends]);

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Fleet Analytics</h1>
            <p className="text-[var(--ff-text-secondary)]">Loading analytics data...</p>
          </div>
          <DashboardSkeleton />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Fleet Analytics</h1>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-2">
              Failed to Load Analytics
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
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <BarChart3 className="w-7 h-7 text-[var(--ff-primary)]" />
              Fleet Analytics
            </h1>
            <p className="text-[var(--ff-text-secondary)]">
              KPI Dashboard • Total Cost of Ownership • Cost Trends
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--ff-text-secondary)]">Period:</span>
            <select
              value={tcoPeriod}
              onChange={(e) => setTcoPeriod(e.target.value as '12m' | 'lifetime')}
              className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
            >
              <option value="12m">Last 12 Months</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </div>
        </div>

        {/* KPI Cards - Row 1 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total Fleet TCO"
            value={formatCurrency(kpis?.totalTCO12m || 0)}
            subtitle={`${tcoPeriod === '12m' ? 'Last 12 months' : 'All time'}`}
            icon={DollarSign}
            color="bg-purple-500"
            trend={kpis?.trends.tcoChange ? { value: kpis.trends.tcoChange, isPositive: kpis.trends.tcoChange < 0 } : null}
          />
          <KPICard
            title="Avg Cost per km"
            value={kpis?.avgCostPerKm ? `R${kpis.avgCostPerKm.toFixed(2)}` : 'N/A'}
            subtitle="Fleet average"
            icon={TrendingUp}
            color="bg-blue-500"
            trend={kpis?.trends.costPerKmChange ? { value: kpis.trends.costPerKmChange, isPositive: kpis.trends.costPerKmChange < 0 } : null}
          />
          <KPICard
            title="Total km Travelled"
            value={formatNumber(kpis?.totalKmTravelled12m || 0)}
            subtitle={`Avg ${formatNumber(kpis?.avgKmPerVehicle || 0)} per vehicle`}
            icon={Car}
            color="bg-cyan-500"
          />
          <KPICard
            title="Fuel Efficiency"
            value={kpis?.fleetAvgFuelConsumption ? `${kpis.fleetAvgFuelConsumption.toFixed(1)} L/100km` : 'N/A'}
            subtitle="Fleet average"
            icon={Fuel}
            color="bg-orange-500"
            trend={kpis?.trends.fuelEfficiencyChange ? { value: kpis.trends.fuelEfficiencyChange, isPositive: kpis.trends.fuelEfficiencyChange < 0 } : null}
          />
        </div>

        {/* KPI Cards - Row 2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total Vehicles"
            value={kpis?.totalVehicles || 0}
            subtitle={`${kpis?.activeVehicles || 0} active`}
            icon={Car}
            color="bg-gray-600"
          />
          <KPICard
            title="Leased Vehicles"
            value={kpis?.leasedVehicles || 0}
            subtitle={formatCurrency(kpis?.totalLeaseCost12m || 0) + '/year'}
            icon={Calendar}
            color="bg-violet-500"
          />
          <KPICard
            title="Fuel Cost"
            value={formatCurrency(kpis?.totalFuelCost12m || 0)}
            subtitle="Last 12 months"
            icon={Fuel}
            color="bg-amber-500"
          />
          <KPICard
            title="Maintenance Cost"
            value={formatCurrency(kpis?.totalMaintenanceCost12m || 0)}
            subtitle="Last 12 months"
            icon={Wrench}
            color="bg-pink-500"
          />
        </div>

        {/* Alerts Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <AlertCard
            title="Services Overdue"
            count={kpis?.servicesOverdue || 0}
            type={kpis?.servicesOverdue ? 'error' : 'info'}
          />
          <AlertCard
            title="Services Due Soon"
            count={kpis?.servicesDueSoon || 0}
            type={kpis?.servicesDueSoon ? 'warning' : 'info'}
          />
          <AlertCard
            title="Check-in Compliance"
            count={Math.round(kpis?.checkInComplianceRate || 0)}
            type={(kpis?.checkInComplianceRate || 0) >= 80 ? 'info' : 'warning'}
          />
          <AlertCard
            title="Overdue Checks"
            count={kpis?.vehiclesWithOverdueChecks || 0}
            type={kpis?.vehiclesWithOverdueChecks ? 'warning' : 'info'}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cost Breakdown Pie Chart */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              TCO Cost Breakdown
            </h3>
            {costBreakdownData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costBreakdownData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {costBreakdownData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      contentStyle={{
                        backgroundColor: 'var(--ff-bg-secondary)',
                        border: '1px solid var(--ff-border-light)',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-[var(--ff-text-secondary)]">
                No cost data available
              </div>
            )}
          </div>

          {/* Ownership Distribution */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              TCO by Ownership Type
            </h3>
            {ownershipData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ownershipData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--ff-text-secondary)' }} />
                    <YAxis tick={{ fill: 'var(--ff-text-secondary)' }} tickFormatter={(v) => `R${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      contentStyle={{
                        backgroundColor: 'var(--ff-bg-secondary)',
                        border: '1px solid var(--ff-border-light)',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="tco" fill={COLORS.primary} radius={[4, 4, 0, 0]} name="Total TCO" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-[var(--ff-text-secondary)]">
                No ownership data available
              </div>
            )}
          </div>
        </div>

        {/* Cost Trends Chart - Full Width */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
            Cost Trends (Last 12 Months)
          </h3>
          {trendChartData.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendChartData}>
                  <defs>
                    <linearGradient id="colorFuel" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.fuel} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={COLORS.fuel} stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorMaintenance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.service} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={COLORS.service} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
                  <XAxis dataKey="period" tick={{ fill: 'var(--ff-text-secondary)' }} />
                  <YAxis tick={{ fill: 'var(--ff-text-secondary)' }} tickFormatter={(v) => `R${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: 'var(--ff-bg-secondary)',
                      border: '1px solid var(--ff-border-light)',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="fuel" stackId="1" stroke={COLORS.fuel} fill="url(#colorFuel)" name="Fuel" />
                  <Area type="monotone" dataKey="maintenance" stackId="1" stroke={COLORS.service} fill="url(#colorMaintenance)" name="Maintenance" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-[var(--ff-text-secondary)]">
              No trend data available
            </div>
          )}
        </div>

        {/* Top Vehicles by TCO */}
        {tcoReport && tcoReport.vehicles.length > 0 && (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              Top Vehicles by TCO ({tcoPeriod === '12m' ? 'Last 12 Months' : 'Lifetime'})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Vehicle</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Type</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">TCO</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">km</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Cost/km</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">L/100km</th>
                  </tr>
                </thead>
                <tbody>
                  {tcoReport.vehicles.slice(0, 10).map((vehicle, index) => (
                    <tr
                      key={vehicle.vehicleId}
                      className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-[var(--ff-text-primary)]">{vehicle.registration}</div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">
                          {vehicle.make} {vehicle.model} {vehicle.year}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                          vehicle.ownershipType === 'company'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                            : vehicle.ownershipType === 'leased'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                        }`}>
                          {vehicle.ownershipType}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-[var(--ff-text-primary)]">
                        {formatCurrency(tcoPeriod === '12m' ? vehicle.tco12m : vehicle.tcoLifetime)}
                      </td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">
                        {formatNumber(tcoPeriod === '12m' ? vehicle.kmTravelled12m : vehicle.kmTravelledLifetime)}
                      </td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">
                        {(tcoPeriod === '12m' ? vehicle.costPerKm12m : vehicle.costPerKmLifetime)
                          ? `R${(tcoPeriod === '12m' ? vehicle.costPerKm12m : vehicle.costPerKmLifetime)!.toFixed(2)}`
                          : '-'}
                      </td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">
                        {vehicle.litresPer100km ? vehicle.litresPer100km.toFixed(1) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
