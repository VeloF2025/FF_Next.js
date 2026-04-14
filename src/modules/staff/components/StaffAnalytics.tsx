/**
 * Staff Analytics - Legacy Compatibility Layer
 * @deprecated Use modular components from './analytics' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './analytics' directly
 */

import { useStaffSummary } from '@/hooks/useStaff';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { 
  StaffKeyMetrics,
  DepartmentDistribution,
  ExperienceLevels,
  ContractTypes,
  TopPerformersTable,
  SkillsOverview
} from './analytics';

export function StaffAnalytics() {
  const { data: summary, isLoading, error } = useStaffSummary();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" label="Loading analytics..." />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <p className="text-red-400">Failed to load staff analytics</p>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-2">Staff Analytics</h2>
        <p className="text-[var(--ff-text-secondary)]">Comprehensive overview of your workforce performance and allocation</p>
      </div>

      <StaffKeyMetrics 
        totalStaff={summary.totalStaff}
        activeStaff={summary.activeStaff}
        inactiveStaff={summary.inactiveStaff}
        availableStaff={summary.availableStaff ?? 0}
        averageProjectLoad={summary.averageProjectLoad ?? 0}
        monthlyGrowth={summary.monthlyGrowth ?? 0}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {summary.staffByDepartment && (
          <DepartmentDistribution 
            staffByDepartment={summary.staffByDepartment}
            totalStaff={summary.totalStaff}
          />
        )}
        
        {summary.staffByLevel && (
          <ExperienceLevels 
            staffByLevel={summary.staffByLevel}
            totalStaff={summary.totalStaff}
          />
        )}
        
        {summary.staffByContractType && (
          <ContractTypes 
            staffByContractType={summary.staffByContractType}
            totalStaff={summary.totalStaff}
          />
        )}
      </div>

      <TopPerformersTable topPerformers={summary.topPerformers as never[] ?? []} />

      <SkillsOverview topSkills={summary.topSkills as never[] ?? []} />
    </div>
  );
}