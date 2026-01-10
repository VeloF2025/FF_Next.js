import type { SectionProps } from '../types/clientSection.types';
import { formatTextUppercase } from '../utils/displayUtils';

export function ContactDetailsSection({ client }: SectionProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Contact Information</h3>

      <div className="space-y-3">
        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Contact Person</p>
          <p className="font-medium text-[var(--ff-text-primary)]">{client.contactPerson}</p>
        </div>

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Primary Email</p>
          <a href={`mailto:${client.email}`} className="text-blue-400 hover:underline">
            {client.email}
          </a>
        </div>

        {client.alternativeEmail && (
          <div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Alternative Email</p>
            <a href={`mailto:${client.alternativeEmail}`} className="text-blue-400 hover:underline">
              {client.alternativeEmail}
            </a>
          </div>
        )}

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Primary Phone</p>
          <a href={`tel:${client.phone}`} className="text-blue-400 hover:underline">
            {client.phone}
          </a>
        </div>

        {client.alternativePhone && (
          <div>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Alternative Phone</p>
            <a href={`tel:${client.alternativePhone}`} className="text-blue-400 hover:underline">
              {client.alternativePhone}
            </a>
          </div>
        )}

        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Communication Preferences</p>
          <p className="font-medium text-[var(--ff-text-primary)]">
            {formatTextUppercase(client.preferredContactMethod)} • {client.communicationLanguage}
          </p>
        </div>
      </div>
    </div>
  );
}