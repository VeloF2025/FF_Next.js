/**
 * Fleet Analytics Dashboard
 * Vehicle scorecard with per-vehicle distance, fuel, compliance metrics
 * Filterable by period, vehicle type, ownership
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import { notificationService } from '@/services/core/NotificationService';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  BarChart3, Gauge, Fuel, CheckCircle2, Car, RefreshCw, AlertTriangle, ArrowUpDown,
  Calendar, Droplets,
} from 'lucide-react';
import type { ScorecardReport, VehicleScorecard } from '@/modules/fleet/types';

type PeriodKey = '1m' | '3m' | '6m' | '12m' | 'custom';
type SortKey = 'registration' | 'totalKm' | 'fuelCost' | 'costPerKm' | 'litresPer100km' | 'checkInCount' | 'complianceRate' | 'avgKmPerDay';
type SortDir = 'asc' | 'desc';

const PERIODS: { key: PeriodKey; label: string; months: number }[] = [
  { key: '1m', label: 'This Month', months: 1 },
  { key: '3m', label: 'Last 3 Months', months: 3 },
  { key: '6m', label: 'Last 6 Months', months: 6 },
  { key: '12m', label: 'Last 12 Months', months: 12 },
  { key: 'custom', label: 'Custom', months: 0 },
];

function getDatesForPeriod(key: PeriodKey): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  const p = PERIODS.find(pp => pp.key === key);
  if (p && p.months > 0) start.setMonth(start.getMonth() - p.months);
  return { start: start.toISOString().split('T')[0]!, end: end.toISOString().split('T')[0]! };
}

function fmt(n: number): string { return n.toLocaleString('en-ZA'); }
function fmtR(n: number): string { return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

const OWNERSHIP_COLORS: Record<string, string> = { company: '#8B5CF6', rental: '#06B6D4', leased: '#F59E0B' };
const VEHICLE_TYPES = ['bakkie', 'sedan', 'van', 'truck', 'suv', 'motorcycle', 'other'];
const OWNERSHIP_TYPES = ['company', 'rental', 'leased'];

export default function FleetAnalyticsPage() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('3m');
  const [startDate, setStartDate] = useState(() => getDatesForPeriod('3m').start);
  const [endDate, setEndDate] = useState(() => getDatesForPeriod('3m').end);
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState('');
  const [report, setReport] = useState<ScorecardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('totalKm');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/analytics/vehicle-scorecard?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) throw new Error('Failed to load scorecard');
      const data = await res.json();
      setReport(data.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setError(msg);
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePeriodChange = (key: PeriodKey) => {
    setPeriodKey(key);
    if (key !== 'custom') {
      const d = getDatesForPeriod(key);
      setStartDate(d.start);
      setEndDate(d.end);
    }
  };

  const filteredVehicles = useMemo(() => {
    if (!report) return [];
    let v = report.vehicles;
    if (vehicleTypeFilter) v = v.filter(x => x.vehicleType === vehicleTypeFilter);
    if (ownershipFilter) v = v.filter(x => x.ownershipType === ownershipFilter);
    return [...v].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      const na = (av as number) ?? -1; const nb = (bv as number) ?? -1;
      return sortDir === 'asc' ? na - nb : nb - na;
    });
  }, [report, vehicleTypeFilter, ownershipFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const distanceData = useMemo(() =>
    filteredVehicles.filter(v => v.totalKm > 0).map(v => ({
      reg: v.registration, km: v.totalKm, type: v.ownershipType,
    })).slice(0, 20), [filteredVehicles]);

  const complianceData = useMemo(() =>
    filteredVehicles.filter(v => v.driverName).map(v => ({
      name: v.driverName!.split(' ').slice(0, 2).join(' '),
      reg: v.registration, rate: v.complianceRate,
    })).sort((a, b) => a.rate - b.rate), [filteredVehicles]);

  // Filtered totals
  const totals = useMemo(() => {
    const km = filteredVehicles.reduce((s, v) => s + v.totalKm, 0);
    const fuel = filteredVehicles.reduce((s, v) => s + v.fuelCost, 0);
    const litres = filteredVehicles.reduce((s, v) => s + v.fuelLitres, 0);
    const checks = filteredVehicles.reduce((s, v) => s + v.checkInCount, 0);
    return { km, fuel, litres, checks, costPerKm: km > 0 ? fuel / km : null, lPer100: km > 0 && litres > 0 ? (litres / km) * 100 : null };
  }, [filteredVehicles]);

  const summary = report?.summary;

  return (
    <AppLayout>
      <ModulePage config={fleetConfig}>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
                <BarChart3 className="w-7 h-7 text-[var(--ff-primary)]" />
                Fleet Analytics
              </h1>
              <p className="text-[var(--ff-text-secondary)]">
                Vehicle Scorecard &bull; {startDate} to {endDate}
                {report && <span className="ml-2 text-xs">({report.daysInRange} days)</span>}
              </p>
            </div>
            <button onClick={fetchData} disabled={loading}
              className="px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <FilterSelect label="Period" value={periodKey} onChange={v => handlePeriodChange(v as PeriodKey)}
              options={PERIODS.map(p => ({ value: p.key, label: p.label }))} />
            <div>
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">From</label>
              <input type="date" value={startDate}
                onChange={e => { setStartDate(e.target.value); if (periodKey !== 'custom') setPeriodKey('custom'); }}
                className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">To</label>
              <input type="date" value={endDate}
                onChange={e => { setEndDate(e.target.value); if (periodKey !== 'custom') setPeriodKey('custom'); }}
                className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <FilterSelect label="Vehicle Type" value={vehicleTypeFilter}
              onChange={setVehicleTypeFilter}
              options={[{ value: '', label: 'All Types' }, ...VEHICLE_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))]} />
            <FilterSelect label="Ownership" value={ownershipFilter}
              onChange={setOwnershipFilter}
              options={[{ value: '', label: 'All' }, ...OWNERSHIP_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))]} />
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" /><span className="text-red-300">{error}</span>
            </div>
          )}

          {/* KPI Cards */}
          {summary && !loading && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KPI icon={Gauge} label="Total KM" value={fmt(totals.km)} sub={`${filteredVehicles.filter(v => v.totalKm > 0).length} vehicles`} />
              <KPI icon={Fuel} label="Fuel Spend" value={fmtR(totals.fuel)} sub={`${filteredVehicles.reduce((s, v) => s + v.fuelTransactions, 0)} transactions`} />
              <KPI icon={Car} label="Cost / km" value={totals.costPerKm ? `R${totals.costPerKm.toFixed(2)}` : '—'} sub="fleet average" />
              <KPI icon={Droplets} label="L/100km" value={totals.lPer100 ? totals.lPer100.toFixed(1) : '—'} sub="fleet average" />
              <KPI icon={Calendar} label="Check-Ins" value={`${totals.checks}`} sub={`${report.daysInRange} day period`} />
              <KPI icon={CheckCircle2} label="Compliance" value={`${summary.fleetAvgCompliance}%`} sub="avg across drivers"
                color={summary.fleetAvgCompliance >= 70 ? 'text-green-400' : summary.fleetAvgCompliance >= 40 ? 'text-yellow-400' : 'text-red-400'} />
            </div>
          )}

          {/* Vehicle Scorecard Table */}
          {!loading && filteredVehicles.length > 0 && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <SortTh label="Vehicle" k="registration" cur={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="py-3 px-3 text-left text-[var(--ff-text-secondary)] font-medium text-xs">Driver</th>
                    <th className="py-3 px-3 text-left text-[var(--ff-text-secondary)] font-medium text-xs">Type</th>
                    <SortTh label="Total KM" k="totalKm" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="KM/Day" k="avgKmPerDay" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="Fuel Cost" k="fuelCost" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="R/km" k="costPerKm" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="L/100km" k="litresPer100km" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="Check-Ins" k="checkInCount" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortTh label="Compliance" k="complianceRate" cur={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {filteredVehicles.map(v => (
                    <>
                      <tr key={v.vehicleId}
                        onClick={() => setExpandedVehicle(expandedVehicle === v.vehicleId ? null : v.vehicleId)}
                        className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] cursor-pointer">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-[var(--ff-text-primary)]">{v.registration}</div>
                          <div className="text-[10px] text-[var(--ff-text-tertiary)]">{[v.make, v.model].filter(Boolean).join(' ')}</div>
                        </td>
                        <td className="py-2.5 px-3 text-[var(--ff-text-secondary)] text-xs max-w-[120px] truncate">{v.driverName || '—'}</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            v.ownershipType === 'company' ? 'bg-purple-900/30 text-purple-400' : 'bg-cyan-900/30 text-cyan-400'
                          }`}>{v.ownershipType}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-[var(--ff-text-primary)]">{fmt(v.totalKm)}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)]">{v.avgKmPerDay > 0 ? fmt(v.avgKmPerDay) : '—'}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)]">{v.fuelCost > 0 ? fmtR(v.fuelCost) : '—'}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)]">{v.costPerKm !== null ? `R${v.costPerKm.toFixed(2)}` : '—'}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)]">{v.litresPer100km !== null ? v.litresPer100km.toFixed(1) : '—'}</td>
                        <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)]">{v.checkInCount}</td>
                        <td className="py-2.5 px-3 text-right"><ComplianceBadge rate={v.complianceRate} /></td>
                      </tr>
                      {expandedVehicle === v.vehicleId && (
                        <tr key={`${v.vehicleId}-detail`} className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                          <td colSpan={10} className="p-4">
                            <VehicleDetail vehicle={v} daysInRange={report?.daysInRange || 1} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                    <td className="py-2.5 px-3 font-semibold text-[var(--ff-text-primary)]" colSpan={3}>
                      Fleet Total ({filteredVehicles.length} vehicles)
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-[var(--ff-text-primary)]">{fmt(totals.km)}</td>
                    <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)] text-xs">
                      {report && totals.km > 0 ? fmt(Math.round(totals.km / report.daysInRange)) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-[var(--ff-text-primary)]">{fmtR(totals.fuel)}</td>
                    <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)] text-xs">
                      {totals.costPerKm ? `R${totals.costPerKm.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[var(--ff-text-secondary)] text-xs">
                      {totals.lPer100 ? totals.lPer100.toFixed(1) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-[var(--ff-text-primary)]">{totals.checks}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Charts */}
          {!loading && distanceData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Distance Ranking (KM)</h3>
                <div className="text-[10px] text-[var(--ff-text-tertiary)] mb-2 flex gap-4">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#8B5CF6]" /> Company</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#06B6D4]" /> Rental</span>
                </div>
                <div style={{ height: Math.max(200, distanceData.length * 32) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distanceData} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
                      <XAxis type="number" tick={{ fill: 'var(--ff-text-secondary)', fontSize: 11 }}
                        tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="reg" width={85} tick={{ fill: 'var(--ff-text-secondary)', fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${fmt(Number(v))} km`, 'Distance']}
                        contentStyle={{ backgroundColor: 'var(--ff-bg-secondary)', border: '1px solid var(--ff-border-light)', borderRadius: '8px' }} />
                      <Bar dataKey="km" radius={[0, 4, 4, 0]}>
                        {distanceData.map((entry, i) => <Cell key={i} fill={OWNERSHIP_COLORS[entry.type] || '#6B7280'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Check-In Compliance by Driver</h3>
                <div style={{ height: Math.max(200, complianceData.length * 32) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={complianceData} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--ff-text-secondary)', fontSize: 11 }}
                        tickFormatter={v => `${v}%`} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--ff-text-secondary)', fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${v}%`, 'Compliance']}
                        contentStyle={{ backgroundColor: 'var(--ff-bg-secondary)', border: '1px solid var(--ff-border-light)', borderRadius: '8px' }} />
                      <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                        {complianceData.map((entry, i) => <Cell key={i} fill={entry.rate >= 70 ? '#10B981' : entry.rate >= 40 ? '#F59E0B' : '#EF4444'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-8 h-8 text-[var(--ff-primary)] animate-spin" />
            </div>
          )}
        </div>
      </ModulePage>
    </AppLayout>
  );
}

// --- Sub-components ---

function VehicleDetail({ vehicle: v, daysInRange }: { vehicle: VehicleScorecard; daysInRange: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <DetailCard title="Distance">
        <DetailRow label="Total KM" value={`${fmt(v.totalKm)} km`} />
        <DetailRow label="Avg per Day" value={v.avgKmPerDay > 0 ? `${fmt(v.avgKmPerDay)} km` : '—'} />
        <DetailRow label="Start Odometer" value={fmt(v.firstReading)} />
        <DetailRow label="End Odometer" value={fmt(v.lastReading)} />
        <DetailRow label="Readings" value={`${v.odometerReadings}`} />
      </DetailCard>
      <DetailCard title="Fuel">
        <DetailRow label="Total Spend" value={v.fuelCost > 0 ? fmtR(v.fuelCost) : '—'} />
        <DetailRow label="Total Litres" value={v.fuelLitres > 0 ? `${v.fuelLitres.toFixed(1)} L` : '—'} />
        <DetailRow label="Cost per km" value={v.costPerKm !== null ? `R${v.costPerKm.toFixed(2)}` : '—'} />
        <DetailRow label="L/100km" value={v.litresPer100km !== null ? v.litresPer100km.toFixed(1) : '—'} />
        <DetailRow label="Transactions" value={`${v.fuelTransactions}`} />
      </DetailCard>
      <DetailCard title="Check-Ins">
        <DetailRow label="Total" value={`${v.checkInCount}`} />
        <DetailRow label="Daily" value={`${v.dailyChecks}`} />
        <DetailRow label="Weekly" value={`${v.weeklyChecks}`} />
        <DetailRow label="Last Check" value={v.lastCheckDate ? new Date(v.lastCheckDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—'} />
        <DetailRow label="Compliance" value={<ComplianceBadge rate={v.complianceRate} />} />
      </DetailCard>
      <DetailCard title="Assignment">
        <DetailRow label="Driver" value={v.driverName || '—'} />
        <DetailRow label="Since" value={v.driverSince ? new Date(v.driverSince).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} />
        <DetailRow label="Vehicle" value={[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'} />
        <DetailRow label="Type" value={`${v.vehicleType} / ${v.ownershipType}`} />
        {v.projectName && <DetailRow label="Project" value={`${v.projectCode} — ${v.projectName}`} />}
      </DetailCard>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-3 border border-[var(--ff-border-light)]">
      <h4 className="text-xs font-semibold text-[var(--ff-primary)] mb-2 uppercase tracking-wide">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-[var(--ff-text-tertiary)]">{label}</span>
      <span className="text-[var(--ff-text-primary)] font-medium">{value}</span>
    </div>
  );
}

function KPI({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-[var(--ff-primary)]" />
        <span className="text-xs text-[var(--ff-text-secondary)]">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color || 'text-[var(--ff-text-primary)]'}`}>{value}</p>
      <p className="text-[10px] text-[var(--ff-text-tertiary)]">{sub}</p>
    </div>
  );
}

function ComplianceBadge({ rate }: { rate: number }) {
  const color = rate >= 70 ? 'bg-green-900/30 text-green-400' : rate >= 40 ? 'bg-yellow-900/30 text-yellow-400' : 'bg-red-900/30 text-red-400';
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>{rate}%</span>;
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SortTh({ label, k, cur, dir, onSort, align = 'left' }: {
  label: string; k: SortKey; cur: SortKey; dir: SortDir; onSort: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const active = k === cur;
  return (
    <th className={`py-3 px-3 text-${align} text-[var(--ff-text-secondary)] font-medium text-xs cursor-pointer hover:text-white transition-colors`}
      onClick={() => onSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? 'text-[var(--ff-primary)]' : 'opacity-40'}`} />
      </span>
    </th>
  );
}
