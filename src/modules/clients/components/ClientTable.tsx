import type { Client } from '@/types/client.types';
import { ClientTableRow } from './ClientTableRow';

interface ClientTableProps {
  clients: Client[] | undefined;
  isLoading: boolean;
  error: Error | null | undefined;
  onDelete: (id: string) => void;
}

export function ClientTable({ clients, isLoading, error, onDelete }: ClientTableProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Client
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Contact
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Category
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Projects
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Value
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  Loading clients...
                </td>
              </tr>
            )}

            {error && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-red-400">
                  Error loading clients: {error.message}
                </td>
              </tr>
            )}

            {clients && clients.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  No clients found
                </td>
              </tr>
            )}

            {clients?.map((client) => (
              <ClientTableRow
                key={client.id}
                client={client}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
