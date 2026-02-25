/**
 * Department Report Component
 * Displays analytics and stats for a department
 */

import React from 'react';
import { formatDisplayDate } from '@/utils/dateFormat';
import { Card, CardContent } from '@/shared/components/ui/Card';
import {
  Users,
  Briefcase,
  Clock,
  Award,
  AlertTriangle,
  TrendingUp,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import type { DepartmentReport as DepartmentReportType } from '@/types/staff/department.types';

interface DepartmentReportProps {
  report: DepartmentReportType;
  isLoading?: boolean;
}

export function DepartmentReport({ report, isLoading }: DepartmentReportProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    active: 'bg-green-500',
    on_leave: 'bg-yellow-500',
    inactive: 'bg-gray-500',
    suspended: 'bg-amber-500',
    terminated: 'bg-red-500',
    resigned: 'bg-orange-500',
    retired: 'bg-blue-500',
  };

  const statusLabels: Record<string, string> = {
    active: 'Active',
    on_leave: 'On Leave',
    inactive: 'Inactive',
    suspended: 'Suspended',
    terminated: 'Terminated',
    resigned: 'Resigned',
    retired: 'Retired',
  };

  const totalStaff = Object.values(report.staffByStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-xs text-[var(--ff-text-secondary)]">
                Compliance
              </span>
            </div>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {report.complianceRate}%
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Briefcase className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-[var(--ff-text-secondary)]">
                Projects
              </span>
            </div>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {report.projectCount}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-[var(--ff-text-secondary)]">
                Avg Tenure
              </span>
            </div>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {Math.round(report.avgTenureDays / 30)}
              <span className="text-sm font-normal text-[var(--ff-text-tertiary)]">
                {' '}
                mo
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-yellow-400" />
              <span className="text-xs text-[var(--ff-text-secondary)]">
                Certs
              </span>
            </div>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {report.certifications.total}
            </p>
            {report.certifications.expiringSoon > 0 && (
              <p className="text-xs text-yellow-400">
                {report.certifications.expiringSoon} expiring soon
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Staff by Status */}
      <Card className="bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
        <CardContent className="p-4">
          <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Staff by Status
          </h4>
          <div className="space-y-2">
            {Object.entries(report.staffByStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <div key={status} className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-[var(--ff-text-secondary)]">
                        {statusLabels[status] || status}
                      </span>
                      <span className="text-[var(--ff-text-primary)]">{count}</span>
                    </div>
                    <div className="h-2 bg-[var(--ff-bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className={`h-full ${statusColors[status] || 'bg-gray-500'} rounded-full`}
                        style={{
                          width: `${totalStaff > 0 ? (count / totalStaff) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Certifications Warning */}
      {(report.certifications.expired > 0 ||
        report.certifications.expiringSoon > 0) && (
        <Card className="bg-yellow-500/10 border-yellow-500/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-yellow-400 mb-1">
                  Certification Alerts
                </h4>
                <ul className="text-sm text-[var(--ff-text-secondary)] space-y-1">
                  {report.certifications.expired > 0 && (
                    <li>{report.certifications.expired} expired certification(s)</li>
                  )}
                  {report.certifications.expiringSoon > 0 && (
                    <li>
                      {report.certifications.expiringSoon} expiring within 30 days
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {report.recentActivity.length > 0 && (
        <Card className="bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
          <CardContent className="p-4">
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">
              Recent Activity
            </h4>
            <div className="space-y-3">
              {report.recentActivity.map((activity, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      activity.type === 'joined'
                        ? 'bg-green-500/20'
                        : 'bg-red-500/20'
                    }`}
                  >
                    {activity.type === 'joined' ? (
                      <UserPlus className="w-4 h-4 text-green-400" />
                    ) : (
                      <UserMinus className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-[var(--ff-text-primary)]">
                      {activity.staffName}
                    </p>
                    <p className="text-xs text-[var(--ff-text-tertiary)]">
                      {activity.details} •{' '}
                      {formatDisplayDate(activity.date)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
