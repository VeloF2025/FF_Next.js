/**
 * Staff Table Component
 */

import { Edit, Trash2, Eye, Mail, Phone } from 'lucide-react';
import type { StaffMember } from '@/types/staff.types';
import { PermissionGate } from '@/components/PermissionGate';

interface StaffTableProps {
  staff: StaffMember[];
  onView: (staff: StaffMember) => void;
  onEdit: (staff: StaffMember) => void;
  onDelete: (id: string) => void;
}

export function StaffTable({ staff, onView, onEdit, onDelete }: StaffTableProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400';
      case 'inactive':
        return 'bg-gray-500/20 text-gray-400';
      case 'on_leave':
        return 'bg-yellow-500/20 text-yellow-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const handleRowClick = (member: StaffMember) => {
    onView(member);
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] shadow-sm border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Staff Member
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Position
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Department
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Contact
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Projects
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
            {staff.map((member) => (
              <tr
                key={member.id}
                onClick={() => handleRowClick(member)}
                className="hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10">
                      <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <span className="text-sm font-medium text-blue-400">
                          {member.name.charAt(0)}{member.name.split(' ')[1]?.charAt(0) || ''}
                        </span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {member.name}
                      </div>
                      <div className="text-sm text-[var(--ff-text-secondary)]">
                        ID: {member.employeeId}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--ff-text-primary)]">{member.position || '-'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--ff-text-primary)]">{member.department || '-'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-2">
                    {member.email && (
                      <a
                        href={`mailto:${member.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        <Mail className="h-4 w-4" />
                      </a>
                    )}
                    {member.phone && (
                      <a
                        href={`tel:${member.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    {member.email?.split('@')[0]}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    getStatusColor(member.status || 'inactive')
                  }`}>
                    {(member.status || 'inactive').replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]">
                  {member.currentProjectCount || 0} / {member.maxProjectCount || 5}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={(e) => handleActionClick(e, () => onView(member))}
                      className="text-blue-400 hover:text-blue-300"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <PermissionGate permission="people.staff" action="edit">
                      <button
                        onClick={(e) => handleActionClick(e, () => onEdit(member))}
                        className="text-indigo-400 hover:text-indigo-300"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </PermissionGate>
                    <PermissionGate permission="people.staff" action="delete">
                      <button
                        onClick={(e) => handleActionClick(e, () => member.id && onDelete(member.id))}
                        className="text-red-400 hover:text-red-300"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </PermissionGate>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
