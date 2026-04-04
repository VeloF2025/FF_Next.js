/**
 * Field Stock Dashboard
 * Main dashboard showing stock overview and key metrics
 */

'use client';

import { useState } from 'react';
import { MapPin, Package, ScanLine, ArrowRightLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useFieldStockDashboard } from '../../hooks';

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  subItems?: { label: string; value: number }[];
  className?: string;
}

function StatsCard({ title, value, icon, subItems, className = '' }: StatsCardProps) {
  return (
    <div className={`rounded-lg border border-border bg-card p-6 dark:border-gray-700 dark:bg-gray-800 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
        </div>
        <div className="rounded-full bg-blue-100 p-3 dark:bg-blue-900/30">
          {icon}
        </div>
      </div>
      {subItems && subItems.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-gray-100 pt-4 dark:border-gray-700">
          {subItems.map((item) => (
            <div key={item.label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AlertCardProps {
  title: string;
  count: number;
  type: 'warning' | 'error' | 'info';
}

function AlertCard({ title, count, type }: AlertCardProps) {
  const colors = {
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
  };

  if (count === 0) return null;

  return (
    <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${colors[type]}`}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">{title}</span>
      </div>
      <span className="rounded-full bg-card/50 px-2 py-0.5 text-sm font-bold">{count}</span>
    </div>
  );
}

interface FieldStockDashboardProps {
  onNavigate?: (tab: string) => void;
}

export function FieldStockDashboard({ onNavigate }: FieldStockDashboardProps) {
  const { summary, loading, error, refresh } = useFieldStockDashboard();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  if (loading && !summary) {
    return <LoadingSpinner className="h-64" size="lg" label="" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
        <p className="font-medium">Error loading dashboard</p>
        <p className="text-sm">{error}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          className="mt-2"
        >
          Try again
        </Button>
      </div>
    );
  }

  const locationSubItems = summary?.locations.byType
    ? Object.entries(summary.locations.byType).map(([key, value]) => ({
        label: key.replace('_', ' ').charAt(0).toUpperCase() + key.slice(1).replace('_', ' '),
        value,
      }))
    : [];

  const itemSubItems = summary?.items.byCategory
    ? Object.entries(summary.items.byCategory).map(([key, value]) => ({
        label: key.replace('_', ' ').toUpperCase(),
        value,
      }))
    : [];

  const serialSubItems = summary?.serials.byStatus
    ? Object.entries(summary.serials.byStatus).map(([key, value]) => ({
        label: key.charAt(0).toUpperCase() + key.slice(1),
        value,
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Field Stock Control</h1>
          <p className="text-sm text-muted-foreground">
            Track materials, serials, and consumption across locations
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Quick Actions - Moved to top for better accessibility */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button onClick={() => onNavigate?.('pickings')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
          <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
            <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">Issue Stock</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Create new transfer</p>
          </div>
        </button>

        <button onClick={() => onNavigate?.('consumptions')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
          <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
            <ScanLine className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">Record Consumption</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Link material to job</p>
          </div>
        </button>

        <button onClick={() => onNavigate?.('returns')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">
          <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30">
            <ArrowRightLeft className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">Process Return</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Return unused stock</p>
          </div>
        </button>

        <button onClick={() => onNavigate?.('locations')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors">
          <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-900/30">
            <MapPin className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p className="font-medium text-[var(--ff-text-primary)]">Manage Locations</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">View all locations</p>
          </div>
        </button>
      </div>

      {/* Alerts Section */}
      {summary && (summary.alerts.lowStock > 0 || summary.alerts.pendingReturns > 0 || summary.alerts.blockedContractors > 0) && (
        <div className="space-y-2">
          <AlertCard title="Low Stock Items" count={summary.alerts.lowStock} type="warning" />
          <AlertCard title="Pending Returns" count={summary.alerts.pendingReturns} type="info" />
          <AlertCard title="Blocked Contractors" count={summary.alerts.blockedContractors} type="error" />
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Locations"
          value={summary?.locations.total || 0}
          icon={<MapPin className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
          subItems={locationSubItems}
        />

        <StatsCard
          title="Stock Items"
          value={summary?.items.total || 0}
          icon={<Package className="h-6 w-6 text-green-600 dark:text-green-400" />}
          subItems={itemSubItems}
        />

        <StatsCard
          title="Serial Numbers"
          value={summary?.serials.total || 0}
          icon={<ScanLine className="h-6 w-6 text-purple-600 dark:text-purple-400" />}
          subItems={serialSubItems}
        />

        <StatsCard
          title="Consumptions"
          value={summary?.consumptions.thisWeek || 0}
          icon={<ArrowRightLeft className="h-6 w-6 text-orange-600 dark:text-orange-400" />}
          subItems={[
            { label: 'Today', value: summary?.consumptions.today || 0 },
            { label: 'This Week', value: summary?.consumptions.thisWeek || 0 },
            { label: 'Unverified', value: summary?.consumptions.unverified || 0 },
          ]}
        />
      </div>

    </div>
  );
}
