
import type { SectionProps } from '../types/clientSection.types';
import { formatCurrency } from '../utils/displayUtils';

export function ProjectMetricsSection({ client }: SectionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Project Metrics</h3>

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-blue-400">{client.activeProjects ?? 0}</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Active Projects</p>
        </div>

        <div className="text-center">
          <p className="text-3xl font-bold text-green-400">{client.completedProjects ?? 0}</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Completed</p>
        </div>

        <div className="text-center">
          <p className="text-3xl font-bold text-[var(--ff-text-secondary)]">
            {client.totalProjects || (Number(client.activeProjects || 0) + Number(client.completedProjects || 0))}
          </p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Total Projects</p>
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-[var(--ff-border-light)]">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Total Project Value</p>
            <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
              {formatCurrency(client.totalProjectValue)}
            </p>
          </div>
          <div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Average Project Value</p>
            <p className="text-xl font-semibold text-[var(--ff-text-primary)]">
              {formatCurrency(client.averageProjectValue)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ServiceTypesSection({ client }: SectionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Service Types</h3>

      <div className="flex flex-wrap gap-2">
        {client.serviceTypes.map(service => (
          <span
            key={service}
            className="px-3 py-1 text-sm font-medium bg-blue-500/20 text-blue-400 rounded-full"
          >
            {service.toUpperCase()}
          </span>
        ))}
      </div>

      {client.specialRequirements && (
        <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
          <p className="text-sm text-[var(--ff-text-tertiary)] mb-2">Special Requirements</p>
          <p className="text-[var(--ff-text-primary)]">{client.specialRequirements}</p>
        </div>
      )}
    </div>
  );
}