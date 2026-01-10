import { Building2, Users, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';

interface ClientSummary {
  totalClients: number;
  activeClients: number;
  prospectClients?: number;
  totalProjects?: number;
  totalProjectValue: number;
  averageProjectValue?: number;
  clientsWithActiveProjects?: number;
  monthlyGrowthRate?: number;
  highPriorityClients?: number;
}

interface ClientSummaryCardsProps {
  summary: ClientSummary;
}

export function ClientSummaryCards({ summary }: ClientSummaryCardsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Clients</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{summary.totalClients}</p>
          </div>
          <Building2 className="h-8 w-8 text-blue-400" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Active Clients</p>
            <p className="text-2xl font-semibold text-green-400">{summary.activeClients}</p>
          </div>
          <Users className="h-8 w-8 text-green-400" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Projects</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{summary.totalProjects || 0}</p>
          </div>
          <TrendingUp className="h-8 w-8 text-orange-400" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Value</p>
            <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{formatCurrency(summary.totalProjectValue)}</p>
          </div>
          <DollarSign className="h-8 w-8 text-purple-400" />
        </div>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)]">High Priority</p>
            <p className="text-2xl font-semibold text-red-400">{summary.highPriorityClients || 0}</p>
          </div>
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>
      </div>
    </div>
  );
}
