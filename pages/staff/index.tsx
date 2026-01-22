import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Input } from '@/shared/components/ui/Input';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Eye,
  Mail,
  Phone,
  UserPlus,
  Upload,
  UserMinus,
  Users
} from 'lucide-react';
import { StaffAlertsPanel } from '@/components/staff/StaffAlertsPanel';

type StaffStatusType = 'active' | 'inactive' | 'on_leave' | 'suspended' | 'terminated' | 'resigned' | 'retired';

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

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [includeFormerEmployees, setIncludeFormerEmployees] = useState(false);

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
        // Use sample data if API fails
        setStaff(getSampleStaff());
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
      // Use sample data as fallback
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
      joinDate: '2022-01-15'
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
      joinDate: '2021-06-20'
    },
    {
      id: '3',
      employeeId: 'EMP003',
      name: 'Mike Williams',
      email: 'mike.williams@company.com',
      phone: '+27 11 234 5680',
      position: 'Field Technician',
      department: 'Field Operations',
      status: 'on_leave',
      projects: 2,
      joinDate: '2022-03-10'
    },
    {
      id: '4',
      employeeId: 'EMP004',
      name: 'Emma Davis',
      email: 'emma.davis@company.com',
      phone: '+27 11 234 5681',
      position: 'Quality Inspector',
      department: 'Quality Assurance',
      status: 'active',
      projects: 4,
      joinDate: '2021-11-05'
    },
    {
      id: '5',
      employeeId: 'EMP005',
      name: 'Tom Brown',
      email: 'tom.brown@company.com',
      phone: '+27 11 234 5682',
      position: 'Junior Technician',
      department: 'Field Operations',
      status: 'inactive',
      projects: 0,
      joinDate: '2023-02-28'
    }
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
    return labels[status] || status.replace('_', ' ');
  };

  const filteredStaff = staff.filter(member => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
                          (member.name?.toLowerCase().includes(search)) ||
                          (member.employeeId?.toLowerCase().includes(search)) ||
                          (member.email?.toLowerCase().includes(search)) ||
                          (member.phone?.toLowerCase().includes(search)) ||
                          (member.position?.toLowerCase().includes(search)) ||
                          (member.department?.toLowerCase().includes(search));
    const matchesDepartment = filterDepartment === 'all' || member.department === filterDepartment;
    const matchesStatus = filterStatus === 'all' || member.status === filterStatus;

    // If includeFormerEmployees is false, filter out terminated/resigned/retired
    const matchesFormerFilter = includeFormerEmployees || !isFormerEmployee(member.status);

    return matchesSearch && matchesDepartment && matchesStatus && matchesFormerFilter;
  });

  // Calculate stats
  const activeStaff = staff.filter(s => !isFormerEmployee(s.status));
  const formerStaff = staff.filter(s => isFormerEmployee(s.status));

  const departments = [...new Set(staff.map(s => s.department).filter(Boolean))];

  const handleView = (member: StaffMember) => {
    router.push(`/staff/${member.id}`);
  };

  const handleEdit = (member: StaffMember) => {
    router.push(`/staff/${member.id}/edit`);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this staff member?')) {
      setStaff(staff.filter(s => s.id !== id));
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-[var(--ff-text-secondary)]">Loading staff...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Staff Management</h1>
            <p className="text-[var(--ff-text-secondary)]">Manage your team members and their assignments</p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => router.push('/staff/import')}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button
              onClick={() => router.push('/staff/new')}
              className="flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Add Staff Member
            </Button>
          </div>
        </div>

        {/* Staff Alerts Panel */}
        <StaffAlertsPanel defaultExpanded={false} />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Current Staff</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{activeStaff.length}</p>
                </div>
                <div className="bg-blue-500/20 p-3 rounded-full">
                  <Users className="h-6 w-6 text-blue-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Active</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{staff.filter(s => s.status === 'active').length}</p>
                </div>
                <div className="bg-green-500/20 p-3 rounded-full">
                  <Eye className="h-6 w-6 text-green-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">On Leave</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{staff.filter(s => s.status === 'on_leave').length}</p>
                </div>
                <div className="bg-yellow-500/20 p-3 rounded-full">
                  <Eye className="h-6 w-6 text-yellow-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Former</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{formerStaff.length}</p>
                </div>
                <div className="bg-gray-500/20 p-3 rounded-full">
                  <UserMinus className="h-6 w-6 text-gray-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Departments</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{departments.length}</p>
                </div>
                <div className="bg-purple-500/20 p-3 rounded-full">
                  <Eye className="h-6 w-6 text-purple-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
              className="px-4 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
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
                  {filteredStaff.map((member) => (
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
                                {member.name ? member.name.charAt(0) : ''}{member.name ? member.name.split(' ')[1]?.charAt(0) || '' : ''}
                              </span>
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                              {member.name || 'Unknown'}
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
                            <a href={`mailto:${member.email}`} onClick={(e) => e.stopPropagation()} className="text-blue-400 hover:text-blue-300">
                              <Mail className="h-4 w-4" />
                            </a>
                          )}
                          {member.phone && (
                            <a href={`tel:${member.phone}`} onClick={(e) => e.stopPropagation()} className="text-blue-400 hover:text-blue-300">
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-[var(--ff-text-primary)]">{member.projects || 0}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleView(member); }}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(member); }}
                            className="text-indigo-400 hover:text-indigo-300"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(member.id); }}
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
              {filteredStaff.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-[var(--ff-text-secondary)]">No staff members found</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};