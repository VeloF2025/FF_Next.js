
import type { SectionProps } from '../types/clientSection.types';

export function NotesSection({ client }: SectionProps) {
  if (!client.notes && (!client.tags || client.tags.length === 0)) {
    return null;
  }

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Additional Information</h3>

      {client.tags && client.tags.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-[var(--ff-text-tertiary)] mb-2">Tags</p>
          <div className="flex flex-wrap gap-2">
            {client.tags.map(tag => (
              <span
                key={tag}
                className="px-2 py-1 text-xs font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {client.notes && (
        <div>
          <p className="text-sm text-[var(--ff-text-tertiary)] mb-2">Notes</p>
          <p className="text-[var(--ff-text-primary)] whitespace-pre-wrap">{client.notes}</p>
        </div>
      )}
    </div>
  );
}