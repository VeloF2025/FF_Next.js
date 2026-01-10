import type { SectionProps } from '../types/clientSection.types';
import { formatText } from '../utils/displayUtils';

export function CompanyDetailsSection({ client }: SectionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Company Details</h3>

      <div className="grid grid-cols-2 gap-4">
        {client.registrationNumber && (
          <div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Registration Number</p>
            <p className="font-medium text-[var(--ff-text-primary)]">{client.registrationNumber}</p>
          </div>
        )}

        {client.vatNumber && (
          <div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">VAT Number</p>
            <p className="font-medium text-[var(--ff-text-primary)]">{client.vatNumber}</p>
          </div>
        )}

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Category</p>
          <p className="font-medium text-[var(--ff-text-primary)]">{formatText(client.category)}</p>
        </div>

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Industry</p>
          <p className="font-medium text-[var(--ff-text-primary)]">{client.industry}</p>
        </div>
      </div>
    </div>
  );
}

export function AddressDetailsSection({ client }: SectionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Address</h3>

      <div className="space-y-2">
        <p className="text-[var(--ff-text-primary)]">{client.address}</p>
        <p className="text-[var(--ff-text-primary)]">
          {client.city}, {client.province} {client.postalCode}
        </p>
        <p className="text-[var(--ff-text-primary)]">{client.country}</p>
      </div>
    </div>
  );
}