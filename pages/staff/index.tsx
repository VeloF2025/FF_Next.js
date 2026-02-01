/**
 * Staff Directory Page
 * Main staff listing with search, filters, and statistics
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Input } from '@/shared/components/ui/Input';
import {
  Search,
  Edit,
  Trash2,
  Eye,
  Mail,
  Phone,
  UserPlus,
  Upload,
  UserMinus,
  Users,
  Building2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import { formatLabel } from '@/lib/utils';

type StaffStatusType = 'active' | 'inactive' | 'on_leave' | 'suspended' | 'terminated' | 'resigned' | 'retired';

type SortColumn = 'name' | 'position' | 'department' | 'status' | 'projects';
type SortDirection = 'asc' | 'desc';

interface StaffMember {
  id: string;
  employeeId: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  status: StaffStatusType;
  projects?: number;
  projectNames?: string;
  joinDate?: string;
  endDate?: string;
  exitType?: string;
  exitReason?: string;
  isRehireable?: boolean;
}

// Helper to check if a status represents a former employee
const isFormerEmployee = (status: StaffStatusType): boolean => {
  return ['terminated', 'resigned', 'retired'].includes(status);
};

function StaffDirectorySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mb-2 animate-pulse"></div>
            <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-16 animate-pulse"></div>
          </div>
        ))}
      </div>
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="h-10 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
      </div>
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-4 border-b border-[var(--ff-border-light)] last:border-0">
            <div className="h-12 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StaffDirectoryPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [includeFormerEmployees, setIncludeFormerEmployees] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/staff');

      if (response.ok) {
        const data = await response.json();
        setStaff(data.data || []);
      } else {
        setStaff(getSampleStaff());
      }
    } catch {
      setStaff(getSampleStaff());
    } finally {
      setLoading(false);
    }
  };

  const getSampleStaff = (): StaffMember[] => [
    {
      id: '1',
      employeeId: 'EMP001',
      name: 'John Smith',
      email: 'john.smith@company.com',
      phone: '+27 11 234 5678',
      position: 'Senior Field Technician',
      department: 'Field Operations',
      status: 'active',
      projects: 3,
      joinDate: '2022-01-15',
    },
    {
      id: '2',
      employeeId: 'EMP002',
      name: 'Sarah Johnson',
      email: 'sarah.johnson@company.com',
      phone: '+27 11 234 5679',
      position: 'Project Manager',
      department: 'Project Management',
      status: 'active',
      projects: 5,
      joinDate: '2021-06-20',
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400';
      case 'inactive':
        return 'bg-gray-500/20 text-gray-400';
      case 'on_leave':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'suspended':
        return 'bg-amber-500/20 text-amber-400';
      case 'terminated':
        return 'bg-red-500/20 text-red-400';
      case 'resigned':
        return 'bg-orange-500/20 text-orange-400';
      case 'retired':
        return 'bg-blue-500/20 text-blue-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      active: 'Active',
      inactive: 'Inactive',
      on_leave: 'On Leave',
      suspended: 'Suspended',
      terminated: 'Terminated',
      resigned: 'Resigned',
      retired: 'Retired',
    };
    return labels[status] || formatLabel(status);
  };

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort icon component
  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const filteredStaff = staff.filter((member) => {
    const search = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      member.name?.toLowerCase().includes(search) ||
      member.employeeId?.toLowerCase().includes(search) ||
      member.email?.toLowerCase().includes(search) ||
      member.phone?.toLowerCase().includes(search) ||
      member.position?.toLowerCase().includes(search) ||
      member.department?.toLowerCase().includes(search);
    const matchesDepartment = filterDepartment === 'all' || member.department === filterDepartment;
    const matchesStatus = filterStatus === 'all' || member.status === filterStatus;
    const matchesFormerFilter = includeFormerEmployees || !isFormerEmployee(member.status);

    return matchesSearch && matchesDepartment && matchesStatus && matchesFormerFilter;
  });

  // Sort the filtered staff
  const sortedStaff = [...filteredStaff].sort((a, b) => {
    let aValue: string | number = '';
    let bValue: string | number = '';

    switch (sortColumn) {
      case 'name':
        aValue = (a.name || '').toLowerCase();
        bValue = (b.name || '').toLowerCase();
        break;
      case 'position':
        aValue = (a.position || '').toLowerCase();
        bValue = (b.position || '').toLowerCase();
        break;
      case 'department':
        aValue = (a.department || '').toLowerCase();
        bValue = (b.department || '').toLowerCase();
        break;
      case 'status':
        aValue = a.status;
        bValue = b.status;
        break;
      case 'projects':
        aValue = (a.projectNames || '').toLowerCase();
        bValue = (b.projectNames || '').toLowerCase();
        break;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Calculate stats
  const activeStaff = staff.filter((s) => !isFormerEmployee(s.status));
  const formerStaff = staff.filter((s) => isFormerEmployee(s.status));
  const departments = [...new Set(staff.map((s) => s.department).filter(Boolean))];

  const handleView = (member: StaffMember) => {
    router.push(`/staff/${member.id}`);
  };

  const handleEdit = (member: StaffMember) => {
    router.push(`/staff/${member.id}/edit`);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this staff member?')) {
      setStaff(staff.filter((s) => s.id !== id));
    }
  };

  // Header actions for ModulePage
  const headerActions = (
    <div className="flex gap-3">
      <Button onClick={() => router.push('/staff/import')} variant="outline" className="flex items-center gap-2">
        <Upload className="h-4 w-4" />
        Import
      </Button>
      <Button onClick={() => router.push('/staff/new')} className="flex items-center gap-2">
        <UserPlus className="h-4 w-4" />
        Add Staff
      </Button>
    </div>
  );

  if (loading) {
    return (
      <AppLayout>
        <ModulePage config={staffConfig} headerActions={headerActions} isLoading>
          <StaffDirectorySkeleton />
        </ModulePage>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <ModulePage config={staffConfig} headerActions={headerActions}>
        <div className="space-y-6">
          {/* Stats Cards */}
          <StatsGrid
            cards={[
              {
                title: 'Current Staff',
                value: activeStaff.length,
                icon: Users,
                color: '#3B82F6',
                subtitle: 'Active roster',
                description: 'Staff currently employed',
                variant: 'detailed',
              },
              {
                title: 'Active',
                value: staff.filter((s) => s.status === 'active').length,
                icon: Eye,
                color: '#10B981',
                subtitle: 'On duty',
                description: 'Staff currently working',
                variant: 'detailed',
              },
              {
                title: 'On Leave',
                value: staff.filter((s) => s.status === 'on_leave').length,
                icon: UserMinus,
                color: '#F59E0B',
                subtitle: 'Away',
                description: 'Staff currently on leave',
                variant: 'detailed',
              },
              {
                title: 'Former',
                value: formerStaff.length,
                icon: UserMinus,
                color: '#6B7280',
                subtitle: 'Past employees',
                description: 'Terminated, resigned, or retired',
                variant: 'detailed',
              },
              {
                title: 'Departments',
                value: departments.length,
                icon: Building2,
                color: '#8B5CF6',
                subtitle: 'Teams',
                description: 'Unique organizational units',
                variant: 'detailed',
              },
            ] as EnhancedStatCardProps[]}
            columns={5}
          />

          {/* Filters */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] h-4 w-4" />
                  <Input
                    type="text"
                    placeholder="Search by name, ID, or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-full"
                  />
                </div>
              </div>
              <select
                value={filterDepartment}
                onChange={(e) => setFilterDepartment(e.target.value)}
                className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-[var(--ff-border-medium)]"
              >
                <option value="all">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {formatLabel(dept)}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-[var(--ff-border-medium)]"
              >
                <option value="all">All Status</option>
                <optgroup label="Current">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on_leave">On Leave</option>
                  <option value="suspended">Suspended</option>
                </optgroup>
                {includeFormerEmployees && (
                  <optgroup label="Former">
                    <option value="terminated">Terminated</option>
                    <option value="resigned">Resigned</option>
                    <option value="retired">Retired</option>
                  </optgroup>
                )}
              </select>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFormerEmployees}
                  onChange={(e) => setIncludeFormerEmployees(e.target.checked)}
                  className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-[var(--ff-text-primary)]">Include Former</span>
              </label>
            </div>
          </div>

          {/* Staff Table */}
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
                  <thead className="bg-[var(--ff-bg-tertiary)]">
                    <tr>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--ff-text-primary)] select-none"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center">
                          Staff Member
                          <SortIcon column="name" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--ff-text-primary)] select-none"
                        onClick={() => handleSort('position')}
                      >
                        <div className="flex items-center">
                          Position
                          <SortIcon column="position" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--ff-text-primary)] select-none"
                        onClick={() => handleSort('department')}
                      >
                        <div className="flex items-center">
                          Department
                          <SortIcon column="department" />
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                        Contact
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--ff-text-primary)] select-none"
                        onClick={() => handleSort('status')}
                      >
                        <div className="flex items-center">
                          Status
                          <SortIcon column="status" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--ff-text-primary)] select-none"
                        onClick={() => handleSort('projects')}
                      >
                        <div className="flex items-center">
                          Projects
                          <SortIcon column="projects" />
                        </div>
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                    {sortedStaff.map((member) => (
                      <tr
                        key={member.id}
                        className="hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors"
                        onClick={() => handleView(member)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                                <span className="text-sm font-medium text-blue-400">
                                  {member.name ? member.name.charAt(0) : ''}
                                  {member.name ? member.name.split(' ')[1]?.charAt(0) || '' : ''}
                                </span>
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                                {member.name || 'Unknown'}
                              </div>
                              <div className="text-sm text-[var(--ff-text-secondary)]">ID: {member.employeeId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-[var(--ff-text-primary)]">{member.position || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-[var(--ff-text-primary)]">{formatLabel(member.department)}</div>
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
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge className={getStatusColor(member.status)} variant="secondary">
                            {getStatusLabel(member.status)}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-[var(--ff-text-primary)] max-w-[200px] truncate" title={member.projectNames || ''}>
                            {member.projectNames || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleView(member);
                              }}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(member);
                              }}
                              className="text-indigo-400 hover:text-indigo-300"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(member.id);
                              }}
                              className="text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedStaff.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-[var(--ff-text-secondary)]">No staff members found</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </ModulePage>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
