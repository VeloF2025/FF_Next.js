/**
 * Staff Directory Page
 * Main staff listing with search, filters, and statistics
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';
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
  AlertTriangle,
  RefreshCw,
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
  profilePhotoUrl?: string | null;
}

// Helper to check if a status represents a former employee
const isFormerEmployee = (status: StaffStatusType): boolean => {
  return ['terminated', 'resigned', 'retired'].includes(status);
};

function staffInitials(name: string): string {
  if (!name) return '';
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function StaffListAvatar({ member }: { member: StaffMember }) {
  const [showFallback, setShowFallback] = useState(!member.profilePhotoUrl);
  return (
    <div className="h-10 w-10 rounded-full bg-blue-500/20 overflow-hidden flex items-center justify-center">
      {member.profilePhotoUrl && !showFallback && (
        <img
          src={member.profilePhotoUrl}
          alt={member.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setShowFallback(true)}
        />
      )}
      {(!member.profilePhotoUrl || showFallback) && (
        <span className="text-sm font-medium text-blue-400">
          {staffInitials(member.name) || '?'}
        </span>
      )}
    </div>
  );
}

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
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      const response = await fetch('/api/staff');

      if (response.ok) {
        const data = await response.json();
        setStaff(data.data || []);
      } else {
        let errorData: { error?: { message?: string } } = {};
        try {
          errorData = await response.json();
        } catch (parseErr) {
          // Non-JSON error body — fall through to the status-code message.
          log.warn('staff list error response was not JSON', {
            status: response.status,
            err: parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
        }
        const message = errorData?.error?.message || `Failed to load staff (${response.status})`;
        setError(message);
        setStaff([]);
      }
    } catch (err) {
      setError('Network error: Unable to connect to server');
      setStaff([]);
    } finally {
      setLoading(false);
    }
  };

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

  if (error) {
    return (
      <AppLayout>
        <ModulePage config={staffConfig} headerActions={headerActions}>
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="p-4 bg-red-500/10 rounded-full">
              <AlertTriangle className="h-12 w-12 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Failed to Load Staff</h2>
            <p className="text-[var(--ff-text-secondary)] text-center max-w-md">{error}</p>
            <Button onClick={fetchStaff} className="flex items-center gap-2 mt-4">
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          </div>
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
                color: '#D97706',
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
                      {/* WCAG: scope="col" + aria-sort on sortable headers; <button> inside <th> for keyboard access */}
                      <th scope="col" aria-sort={sortColumn === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left">
                        <button
                          type="button"
                          onClick={() => handleSort('name')}
                          className="flex items-center w-full px-6 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide hover:text-[var(--ff-text-primary)] select-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]"
                        >
                          Staff Member
                          <SortIcon column="name" />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortColumn === 'position' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left">
                        <button
                          type="button"
                          onClick={() => handleSort('position')}
                          className="flex items-center w-full px-6 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide hover:text-[var(--ff-text-primary)] select-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]"
                        >
                          Position
                          <SortIcon column="position" />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortColumn === 'department' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left">
                        <button
                          type="button"
                          onClick={() => handleSort('department')}
                          className="flex items-center w-full px-6 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide hover:text-[var(--ff-text-primary)] select-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]"
                        >
                          Department
                          <SortIcon column="department" />
                        </button>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                        Contact
                      </th>
                      <th scope="col" aria-sort={sortColumn === 'status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left">
                        <button
                          type="button"
                          onClick={() => handleSort('status')}
                          className="flex items-center w-full px-6 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide hover:text-[var(--ff-text-primary)] select-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]"
                        >
                          Status
                          <SortIcon column="status" />
                        </button>
                      </th>
                      <th scope="col" aria-sort={sortColumn === 'projects' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'} className="text-left">
                        <button
                          type="button"
                          onClick={() => handleSort('projects')}
                          className="flex items-center w-full px-6 py-3 text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide hover:text-[var(--ff-text-primary)] select-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]"
                        >
                          Projects
                          <SortIcon column="projects" />
                        </button>
                      </th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                    {sortedStaff.map((member) => (
                      // WCAG: tabIndex + onKeyDown + aria-label makes row keyboard accessible (M1)
                      <tr
                        key={member.id}
                        className="hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]"
                        onClick={() => handleView(member)}
                        onKeyDown={(e) => e.key === 'Enter' && handleView(member)}
                        tabIndex={0}
                        aria-label={`View ${member.name || 'staff member'}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <StaffListAvatar member={member} />
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
                          {/* WCAG: icon-only links need aria-label (C2) */}
                          <div className="flex items-center space-x-2">
                            {member.email && (
                              <a
                                href={`mailto:${member.email}`}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Email ${member.name || 'staff member'}`}
                                className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded"
                              >
                                <Mail className="h-4 w-4" aria-hidden="true" />
                              </a>
                            )}
                            {member.phone && (
                              <a
                                href={`tel:${member.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Call ${member.name || 'staff member'}`}
                                className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded"
                              >
                                <Phone className="h-4 w-4" aria-hidden="true" />
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
                          {/* WCAG: icon-only buttons need aria-label (C1) */}
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleView(member);
                              }}
                              aria-label={`View ${member.name || 'staff member'}`}
                              className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded p-0.5"
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(member);
                              }}
                              aria-label={`Edit ${member.name || 'staff member'}`}
                              className="text-indigo-400 hover:text-indigo-300 focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] rounded p-0.5"
                            >
                              <Edit className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(member.id);
                              }}
                              aria-label={`Delete ${member.name || 'staff member'}`}
                              className="text-red-400 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500 rounded p-0.5"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
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
