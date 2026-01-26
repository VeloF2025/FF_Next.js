/**
 * Staff Alerts Page
 * Shows all staff-related alerts: expiring documents, missing compliance, etc.
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import {
  AlertTriangle,
  FileWarning,
  RefreshCw,
  Calendar,
  ExternalLink,
} from 'lucide-react';

interface ExpiryAlert {
  id: string;
  staffId: string;
  staffName: string;
  documentType: string;
  documentName: string;
  expiryDate: string;
  daysUntil: number;
  severity: 'critical' | 'warning' | 'info';
}

function AlertsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <div className="h-16 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  );
}

export default function StaffAlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/staff/alerts?type=expiring&days=90');
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.expiring || []);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'warning':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getDaysText = (days: number) => {
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Expires today';
    if (days === 1) return 'Expires tomorrow';
    return `${days} days`;
  };

  const filteredAlerts = filter === 'all' ? alerts : alerts.filter((a) => a.severity === filter);

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;
  const infoCount = alerts.filter((a) => a.severity === 'info').length;

  // Header actions
  const headerActions = (
    <button
      onClick={fetchAlerts}
      className="px-4 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors flex items-center gap-2"
    >
      <RefreshCw className="w-4 h-4" />
      Refresh
    </button>
  );

  if (loading) {
    return (
      <AppLayout>
        <ModulePage config={staffConfig} headerActions={headerActions} isLoading>
          <AlertsSkeleton />
        </ModulePage>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ModulePage config={staffConfig} headerActions={headerActions}>
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div
              className={`bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg cursor-pointer transition-all ${filter === 'all' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('all')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">All Alerts</p>
                    <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{alerts.length}</p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-blue-400" />
                </div>
              </CardContent>
            </div>
            <div
              className={`bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg cursor-pointer transition-all ${filter === 'critical' ? 'ring-2 ring-red-500' : ''}`}
              onClick={() => setFilter('critical')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">Critical</p>
                    <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
                  </div>
                  <FileWarning className="h-8 w-8 text-red-400" />
                </div>
              </CardContent>
            </div>
            <div
              className={`bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg cursor-pointer transition-all ${filter === 'warning' ? 'ring-2 ring-yellow-500' : ''}`}
              onClick={() => setFilter('warning')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">Warning</p>
                    <p className="text-2xl font-bold text-yellow-400">{warningCount}</p>
                  </div>
                  <FileWarning className="h-8 w-8 text-yellow-400" />
                </div>
              </CardContent>
            </div>
            <div
              className={`bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg cursor-pointer transition-all ${filter === 'info' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('info')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">Info</p>
                    <p className="text-2xl font-bold text-blue-400">{infoCount}</p>
                  </div>
                  <Calendar className="h-8 w-8 text-blue-400" />
                </div>
              </CardContent>
            </div>
          </div>

          {/* Alerts List */}
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-0">
              {filteredAlerts.length === 0 ? (
                <div className="text-center py-12">
                  <AlertTriangle className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                  <p className="text-[var(--ff-text-secondary)]">
                    {filter === 'all' ? 'No document alerts at this time' : `No ${filter} alerts`}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--ff-border-light)]">
                  {filteredAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      onClick={() => router.push(`/staff/${alert.staffId}`)}
                      className="flex items-center justify-between p-4 hover:bg-[var(--ff-bg-tertiary)] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-lg ${getSeverityColor(alert.severity)}`}>
                          <FileWarning className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-[var(--ff-text-primary)]">{alert.staffName}</p>
                          <p className="text-sm text-[var(--ff-text-secondary)]">
                            {alert.documentName} • Expires {formatDate(alert.expiryDate)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={getSeverityColor(alert.severity)}>
                          {alert.daysUntil < 0 ? 'EXPIRED' : getDaysText(alert.daysUntil)}
                        </Badge>
                        <ExternalLink className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ModulePage>
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return { props: {} };
};
