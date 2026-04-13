/**
 * Staff Alerts Panel Component
 * Displays upcoming birthdays, expiring documents, and compliance stats
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import {
  Cake,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  FileWarning,
  RefreshCw,
  Bell,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDisplayDateShort } from '@/utils/dateFormat';
import { log } from '@/lib/logger';

interface BirthdayAlert {
  id: string;
  name: string;
  email: string | null;
  dateOfBirth: string;
  department: string | null;
  position: string | null;
  daysUntil: number;
  age: number;
}

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

interface ComplianceStats {
  totalStaff: number;
  withVerifiedId: number;
  withVerifiedPassport: number;
  withVerifiedLicense: number;
  withVerifiedBankDetails: number;
  withDob: number;
  missingDocuments: Array<{
    staffId: string;
    staffName: string;
    missingTypes: string[];
  }>;
  compliancePercentage: number;
}

interface AlertsData {
  birthdays?: BirthdayAlert[];
  expiring?: ExpiryAlert[];
  compliance?: ComplianceStats;
}

interface StaffAlertsPanelProps {
  className?: string;
  defaultExpanded?: boolean;
}

export function StaffAlertsPanel({ className = '', defaultExpanded = true }: StaffAlertsPanelProps) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<'birthdays' | 'expiring' | 'compliance'>('birthdays');

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/staff/alerts?type=all&days=30');
      if (response.ok) {
        const data = await response.json();
        setAlerts(data);
      }
    } catch (error) {
      log.error('Error fetching staff alerts', { error }, 'StaffAlertsPanel');
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
    return formatDisplayDateShort(dateStr);
  };

  const getDaysText = (days: number) => {
    if (days < 0) return `${Math.abs(days)}d ago`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days}d`;
  };

  // Count alerts by type
  const birthdayCount = alerts?.birthdays?.length || 0;
  const expiryCount = alerts?.expiring?.length || 0;
  const criticalCount = alerts?.expiring?.filter(e => e.severity === 'critical').length || 0;
  const complianceRate = alerts?.compliance?.compliancePercentage || 0;

  const hasAlerts = birthdayCount > 0 || expiryCount > 0;

  if (loading) {
    return (
      <Card className={`bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] ${className}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-[var(--ff-text-secondary)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Loading alerts...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] ${className}`}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-left hover:text-[var(--ff-accent)] transition-colors"
          >
            <Bell className="h-5 w-5 text-[var(--ff-accent)]" />
            <CardTitle className="text-lg">Staff Alerts</CardTitle>
            {hasAlerts && (
              <Badge className="bg-red-500/20 text-red-400 ml-2">
                {birthdayCount + expiryCount}
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-[var(--ff-text-secondary)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--ff-text-secondary)]" />
            )}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAlerts}
            className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Quick Stats Summary */}
        {!expanded && (
          <div className="flex gap-4 mt-2 text-sm">
            {birthdayCount > 0 && (
              <span className="flex items-center gap-1 text-pink-400">
                <Cake className="h-4 w-4" />
                {birthdayCount} birthday{birthdayCount > 1 ? 's' : ''}
              </span>
            )}
            {expiryCount > 0 && (
              <span className={`flex items-center gap-1 ${criticalCount > 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                <FileWarning className="h-4 w-4" />
                {expiryCount} expiring
              </span>
            )}
            <span className="flex items-center gap-1 text-[var(--ff-text-secondary)]">
              <ShieldCheck className="h-4 w-4" />
              {complianceRate}% compliant
            </span>
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 pt-2">
          {/* Tab Navigation */}
          <div className="flex border-b border-[var(--ff-border-light)] mb-4">
            <button
              onClick={() => setActiveTab('birthdays')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'birthdays'
                  ? 'border-pink-500 text-pink-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Cake className="h-4 w-4" />
                Birthdays
                {birthdayCount > 0 && (
                  <Badge className="bg-pink-500/20 text-pink-400 text-xs">
                    {birthdayCount}
                  </Badge>
                )}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('expiring')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'expiring'
                  ? 'border-yellow-500 text-yellow-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Expiring Docs
                {expiryCount > 0 && (
                  <Badge className={criticalCount > 0 ? 'bg-red-500/20 text-red-400 text-xs' : 'bg-yellow-500/20 text-yellow-400 text-xs'}>
                    {expiryCount}
                  </Badge>
                )}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('compliance')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'compliance'
                  ? 'border-green-500 text-green-400'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Compliance
              </span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {/* Birthdays Tab */}
            {activeTab === 'birthdays' && (
              <>
                {birthdayCount === 0 ? (
                  <p className="text-[var(--ff-text-secondary)] text-sm py-4 text-center">
                    No upcoming birthdays in the next 30 days
                  </p>
                ) : (
                  alerts?.birthdays?.map((birthday) => (
                    <div
                      key={birthday.id}
                      onClick={() => router.push(`/staff/${birthday.id}`)}
                      className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${birthday.daysUntil === 0 ? 'bg-pink-500/30' : 'bg-pink-500/20'}`}>
                          <Cake className={`h-4 w-4 ${birthday.daysUntil === 0 ? 'text-pink-300' : 'text-pink-400'}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                            {birthday.name}
                            {birthday.daysUntil === 0 && ' 🎂'}
                          </p>
                          <p className="text-xs text-[var(--ff-text-secondary)]">
                            Turning {birthday.age} on {formatDate(birthday.dateOfBirth)}
                            {birthday.department && ` • ${birthday.department}`}
                          </p>
                        </div>
                      </div>
                      <Badge className={birthday.daysUntil === 0 ? 'bg-pink-500/30 text-pink-300' : 'bg-pink-500/20 text-pink-400'}>
                        {getDaysText(birthday.daysUntil)}
                      </Badge>
                    </div>
                  ))
                )}
              </>
            )}

            {/* Expiring Documents Tab */}
            {activeTab === 'expiring' && (
              <>
                {expiryCount === 0 ? (
                  <p className="text-[var(--ff-text-secondary)] text-sm py-4 text-center">
                    No documents expiring in the next 30 days
                  </p>
                ) : (
                  alerts?.expiring?.map((expiry) => (
                    <div
                      key={expiry.id}
                      onClick={() => router.push(`/staff/${expiry.staffId}`)}
                      className="flex items-center justify-between p-3 bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${getSeverityColor(expiry.severity)}`}>
                          <FileWarning className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                            {expiry.staffName}
                          </p>
                          <p className="text-xs text-[var(--ff-text-secondary)]">
                            {expiry.documentName} • Expires {formatDate(expiry.expiryDate)}
                          </p>
                        </div>
                      </div>
                      <Badge className={getSeverityColor(expiry.severity)}>
                        {expiry.daysUntil < 0 ? 'EXPIRED' : getDaysText(expiry.daysUntil)}
                      </Badge>
                    </div>
                  ))
                )}
              </>
            )}

            {/* Compliance Tab */}
            {activeTab === 'compliance' && alerts?.compliance && (
              <div className="space-y-4">
                {/* Compliance Score */}
                <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-[var(--ff-text-secondary)]">Overall Compliance</span>
                    <span className={`text-2xl font-bold ${
                      complianceRate >= 80 ? 'text-green-400' :
                      complianceRate >= 60 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {complianceRate}%
                    </span>
                  </div>
                  <div className="w-full bg-[var(--ff-bg-secondary)] rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        complianceRate >= 80 ? 'bg-green-500' :
                        complianceRate >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${complianceRate}%` }}
                    />
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <p className="text-xs text-[var(--ff-text-secondary)]">Total Staff</p>
                    <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                      {alerts.compliance.totalStaff}
                    </p>
                  </div>
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <p className="text-xs text-[var(--ff-text-secondary)]">With SA ID</p>
                    <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                      {alerts.compliance.withVerifiedId}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({Math.round((alerts.compliance.withVerifiedId / alerts.compliance.totalStaff) * 100)}%)
                      </span>
                    </p>
                  </div>
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <p className="text-xs text-[var(--ff-text-secondary)]">With Bank Details</p>
                    <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                      {alerts.compliance.withVerifiedBankDetails}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({Math.round((alerts.compliance.withVerifiedBankDetails / alerts.compliance.totalStaff) * 100)}%)
                      </span>
                    </p>
                  </div>
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <p className="text-xs text-[var(--ff-text-secondary)]">With DOB</p>
                    <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                      {alerts.compliance.withDob}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({Math.round((alerts.compliance.withDob / alerts.compliance.totalStaff) * 100)}%)
                      </span>
                    </p>
                  </div>
                </div>

                {/* Missing Documents List */}
                {alerts.compliance.missingDocuments.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                      Staff with Missing Documents ({alerts.compliance.missingDocuments.length})
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {alerts.compliance.missingDocuments.slice(0, 10).map((staff) => (
                        <div
                          key={staff.staffId}
                          onClick={() => router.push(`/staff/${staff.staffId}`)}
                          className="flex items-center justify-between p-2 bg-[var(--ff-bg-tertiary)] rounded hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
                        >
                          <span className="text-sm text-[var(--ff-text-primary)]">{staff.staffName}</span>
                          <div className="flex gap-1">
                            {staff.missingTypes.map((type) => (
                              <Badge key={type} className="bg-red-500/20 text-red-400 text-xs">
                                {type}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {alerts.compliance.missingDocuments.length > 10 && (
                      <p className="text-xs text-[var(--ff-text-secondary)] mt-2 text-center">
                        +{alerts.compliance.missingDocuments.length - 10} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default StaffAlertsPanel;
