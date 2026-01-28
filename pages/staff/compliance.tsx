/**
 * Staff Compliance Page
 * Shows compliance statistics and staff with missing documents
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Users,
  FileCheck,
  FileText,
  CreditCard,
  Calendar,
  ExternalLink,
} from 'lucide-react';

interface ComplianceStats {
  totalStaff: number;
  withVerifiedId: number;
  withVerifiedPassport: number;
  withVerifiedLicense: number;
  withVerifiedBankDetails: number;
  withVerifiedContract: number;
  withDob: number;
  missingDocuments: Array<{
    staffId: string;
    staffName: string;
    missingTypes: string[];
  }>;
  compliancePercentage: number;
}

function ComplianceSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <div className="h-20 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
          </div>
        ))}
      </div>
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
      </div>
    </div>
  );
}

export default function StaffCompliancePage() {
  const router = useRouter();
  const [compliance, setCompliance] = useState<ComplianceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCompliance();
  }, []);

  const fetchCompliance = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/staff/alerts?type=compliance');
      if (response.ok) {
        const data = await response.json();
        setCompliance(data.compliance || null);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  };

  const getPercentage = (value: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  };

  const getComplianceColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getComplianceBgColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Header actions
  const headerActions = (
    <button
      onClick={fetchCompliance}
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
          <ComplianceSkeleton />
        </ModulePage>
      </AppLayout>
    );
  }

  if (!compliance) {
    return (
      <AppLayout>
        <ModulePage config={staffConfig} headerActions={headerActions}>
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="py-12 text-center">
              <ShieldAlert className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">Unable to load compliance data</p>
            </CardContent>
          </Card>
        </ModulePage>
      </AppLayout>
    );
  }

  const complianceRate = compliance.compliancePercentage;

  return (
    <AppLayout>
      <ModulePage config={staffConfig} headerActions={headerActions}>
        <div className="space-y-6">
          {/* Overall Compliance Score */}
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Overall Compliance</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Based on verified documents across all staff
                  </p>
                </div>
                <div className={`text-4xl font-bold ${getComplianceColor(complianceRate)}`}>{complianceRate}%</div>
              </div>
              <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-4">
                <div
                  className={`h-4 rounded-full transition-all ${getComplianceBgColor(complianceRate)}`}
                  style={{ width: `${complianceRate}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <Users className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--ff-text-secondary)]">Total Staff</p>
                    <p className="text-xl font-bold text-[var(--ff-text-primary)]">{compliance.totalStaff}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/20">
                    <FileCheck className="h-5 w-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--ff-text-secondary)]">With SA ID</p>
                    <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                      {compliance.withVerifiedId}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({getPercentage(compliance.withVerifiedId, compliance.totalStaff)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <FileCheck className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--ff-text-secondary)]">With License</p>
                    <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                      {compliance.withVerifiedLicense}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({getPercentage(compliance.withVerifiedLicense, compliance.totalStaff)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/20">
                    <CreditCard className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--ff-text-secondary)]">Bank Details</p>
                    <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                      {compliance.withVerifiedBankDetails}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({getPercentage(compliance.withVerifiedBankDetails, compliance.totalStaff)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/20">
                    <FileText className="h-5 w-5 text-orange-400" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--ff-text-secondary)]">Contract</p>
                    <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                      {compliance.withVerifiedContract || 0}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({getPercentage(compliance.withVerifiedContract || 0, compliance.totalStaff)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-pink-500/20">
                    <Calendar className="h-5 w-5 text-pink-400" />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--ff-text-secondary)]">With DOB</p>
                    <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                      {compliance.withDob}
                      <span className="text-xs text-[var(--ff-text-secondary)] ml-1">
                        ({getPercentage(compliance.withDob, compliance.totalStaff)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Staff with Missing Documents */}
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-0">
              <div className="p-4 border-b border-[var(--ff-border-light)]">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-red-400" />
                    Staff with Missing Documents ({compliance.missingDocuments.length})
                  </h3>
                </div>
              </div>
              {compliance.missingDocuments.length === 0 ? (
                <div className="py-12 text-center">
                  <ShieldCheck className="h-12 w-12 text-green-400 mx-auto mb-4" />
                  <p className="text-[var(--ff-text-secondary)]">All staff have complete documentation!</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--ff-border-light)]">
                  {compliance.missingDocuments.map((staff) => (
                    <div
                      key={staff.staffId}
                      onClick={() => router.push(`/staff/${staff.staffId}`)}
                      className="flex items-center justify-between p-4 hover:bg-[var(--ff-bg-tertiary)] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-red-500/20">
                          <ShieldAlert className="h-5 w-5 text-red-400" />
                        </div>
                        <span className="font-medium text-[var(--ff-text-primary)]">{staff.staffName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1 flex-wrap justify-end">
                          {staff.missingTypes.map((type) => (
                            <Badge key={type} className="bg-red-500/20 text-red-400 text-xs">
                              {type}
                            </Badge>
                          ))}
                        </div>
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
