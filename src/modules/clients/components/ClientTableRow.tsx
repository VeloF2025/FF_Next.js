'use client';

import { useRouter } from 'next/router';
import { Edit, Trash2, Eye, Mail, Phone } from 'lucide-react';
import type { Client } from '@/types/client.types';
import { getStatusColor, getPriorityColor, getCategoryIcon, formatCurrency } from '../utils/clientUtils';
import { PermissionGate } from '@/components/PermissionGate';

interface ClientTableRowProps {
  client: Client;
  onDelete: (id: string) => void;
}

export function ClientTableRow({ client, onDelete }: ClientTableRowProps) {
  const router = useRouter();

  const handleRowClick = () => {
    router.push(`/app/clients/${client.id}`);
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <tr
      onClick={handleRowClick}
      className="hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
    >
      <td className="px-4 py-4">
        <div className="flex items-center">
          <div className="h-10 w-10 bg-blue-500/20 rounded-full flex items-center justify-center text-lg">
            {getCategoryIcon(client.category)}
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">{client.name}</p>
            <p className="text-xs text-[var(--ff-text-secondary)]">{client.industry}</p>
          </div>
        </div>
      </td>

      <td className="px-4 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-[var(--ff-text-primary)]">{client.contactPerson}</p>
          <div className="flex items-center gap-2 text-xs">
            <a
              href={`mailto:${client.email}`}
              onClick={(e) => e.stopPropagation()}
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <Mail className="h-3 w-3" />
              {client.email}
            </a>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <a
              href={`tel:${client.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <Phone className="h-3 w-3" />
              {client.phone}
            </a>
          </div>
        </div>
      </td>

      <td className="px-4 py-4">
        <p className="text-sm text-[var(--ff-text-primary)]">
          {client.category.replace('_', ' ').charAt(0).toUpperCase() + client.category.slice(1)}
        </p>
      </td>

      <td className="px-4 py-4">
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(client.status)}`}>
          {client.status}
        </span>
      </td>

      <td className="px-4 py-4">
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(client.priority)}`}>
          {client.priority}
        </span>
      </td>

      <td className="px-4 py-4">
        <div className="text-sm">
          <p className="text-[var(--ff-text-primary)]">
            {client.activeProjects} active
          </p>
          <p className="text-xs text-[var(--ff-text-secondary)]">
            {client.totalProjects} total
          </p>
        </div>
      </td>

      <td className="px-4 py-4">
        <div className="text-sm">
          <p className="text-[var(--ff-text-primary)] font-medium">
            {formatCurrency(client.totalProjectValue || 0)}
          </p>
          <p className="text-xs text-[var(--ff-text-secondary)]">
            {client.paymentTerms ? client.paymentTerms.replace('_', ' ') : 'Net 30'}
          </p>
        </div>
      </td>

      <td className="px-4 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => handleActionClick(e, () => router.push(`/app/clients/${client.id}`))}
            className="p-1 text-blue-400 hover:text-blue-300"
            title="View"
          >
            <Eye className="h-4 w-4" />
          </button>
          <PermissionGate permission="clients.list" action="edit">
            <button
              onClick={(e) => handleActionClick(e, () => router.push(`/app/clients/${client.id}/edit`))}
              className="p-1 text-indigo-400 hover:text-indigo-300"
              title="Edit"
            >
              <Edit className="h-4 w-4" />
            </button>
          </PermissionGate>
          <PermissionGate permission="clients.list" action="delete">
            <button
              onClick={(e) => handleActionClick(e, () => onDelete(client.id!))}
              className="p-1 text-red-400 hover:text-red-300"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </PermissionGate>
        </div>
      </td>
    </tr>
  );
}
