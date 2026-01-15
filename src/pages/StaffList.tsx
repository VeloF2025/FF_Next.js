import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { notificationService } from '@/services/core/NotificationService';
import {
  Users,
  Activity,
  UserCheck,
  Clock
} from 'lucide-react';
import { staffService } from '@/services/staffService';
import { StaffImport } from '@/components/staff/StaffImport';
import { StaffFilter, Department, StaffStatus, StaffLevel, StaffMember } from '@/types/staff.types';
import { format } from 'date-fns';
// import { Timestamp } from 'firebase/firestore'; // Unused in current implementation
import { safeToDate } from '@/utils/dateHelpers';
import {
  StandardModuleHeader,
  StandardSummaryCards,
  StandardSearchFilter,
  StandardDataTable,
} from '@/components/ui';

export function StaffList() {
  const navigate = useNavigate();
  const [searchTerm] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<StaffFilter>({});
  const [showFilters] = useState(false);

  const { data: staff, isLoading, refetch } = useQuery<StaffMember[]>({
    queryKey: ['staff', filter],
    queryFn: () => staffService.getAll(filter)
  });

  const { data: summary } = useQuery({
    queryKey: ['staff-summary'],
    queryFn: () => staffService.getStaffSummary()
  });



  const handleExport = async () => {
    try {
      // TODO: Implement export functionality
      notificationService.info('Export functionality not yet implemented');
    } catch (error) {
      notificationService.error('Failed to export staff data');
    }
  };


  const getStatusColor = (status: StaffStatus) => {
    switch (status) {
      case StaffStatus.ACTIVE:
        return 'bg-green-100 text-green-800';
      case StaffStatus.ON_LEAVE:
        return 'bg-yellow-100 text-yellow-800';
      case StaffStatus.INACTIVE:
      case StaffStatus.SUSPENDED:
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const StatusBadge = ({ status }: { status: StaffStatus }) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
      {status ? status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Unknown'}
    </span>
  );

  // Calculate summary statistics
  const summaryStats = summary ? [
    {
      title: 'Total Staff',
      value: summary.totalStaff,
      icon: Users,
      color: 'blue' as const,
      trend: { value: 5, isPositive: true }
    },
    {
      title: 'Active Staff',
      value: summary.activeStaff,
      icon: UserCheck,
      color: 'green' as const,
      trend: { value: 3, isPositive: true }
    },
    {
      title: 'On Leave',
      value: summary.onLeaveStaff,
      icon: Clock,
      color: 'yellow' as const,
      trend: { value: 1, isPositive: false }
    },
    {
      title: 'Utilization Rate',
      value: `${summary.utilizationRate.toFixed(0)}%`,
      icon: Activity,
      color: 'purple' as const,
      trend: { value: 8, isPositive: true }
    }
  ] : [];

  // Table columns configuration
  const tableColumns = [
    { key: 'employeeId', header: 'Employee ID' },
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone' },
    { 
      key: 'department', 
      header: 'Department'
    },
    { 
      key: 'position', 
      header: 'Position'
    },
    { 
      key: 'level', 
      header: 'Level'
    },
    { 
      key: 'status', 
      header: 'Status',
      render: (staff: StaffMember) => <StatusBadge status={staff.status} />
    },
    { 
      key: 'startDate', 
      header: 'Start Date',
      render: (staff: StaffMember) => {
        if (!staff.startDate) return '-';
        const d = safeToDate(staff.startDate);
        return format(d, 'dd MMM yyyy');
      }
    }
  ];

  // Filter staff based on search term
  const filteredStaff = staff?.filter((s: StaffMember) =>
    s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.employeeId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.phone?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (showImport) {
    return (
      <div>
        <div className="mb-4">
          <button
            onClick={() => {
              setShowImport(false);
              refetch();
            }}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Staff List
          </button>
        </div>
        <StaffImport />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <StandardModuleHeader
        title="Staff Management"
        description="Manage your team members and their information"
        itemCount={staff?.length || 0}
        onAdd={() => navigate('/app/staff/new')}
        addButtonText="Add Staff Member"
        onImport={() => setShowImport(true)}
        onExport={handleExport}
        exportDisabled={!staff || staff.length === 0}
      />

      {/* Summary Cards */}
      {summary && <StandardSummaryCards cards={summaryStats.map(stat => ({ 
        label: stat.title, 
        value: stat.value, 
        icon: stat.icon,
        iconBgColor: `bg-${stat.color}-100`,
        iconColor: `text-${stat.color}-600`,
        trend: stat.trend
      }))} />}

      {/* Search and Filters */}
      <StandardSearchFilter
        onSearch={(term: string) => setFilter(prev => ({ ...prev, searchTerm: term }))}
        placeholder="Search by name, email, phone, or employee ID..."
        searchValue={searchTerm}
        showFilters={showFilters && (!!filter.department || !!filter.level || !!filter.status)}
      />

      {/* Custom Filters */}
      {showFilters && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <select
                value={filter.department?.[0] || ''}
                onChange={(e) => {
                  const newFilter = { ...filter };
                  if (e.target.value) {
                    newFilter.department = [e.target.value as Department];
                  } else {
                    delete newFilter.department;
                  }
                  setFilter(newFilter);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">All Departments</option>
                {Object.values(Department).map(dept => (
                  <option key={dept} value={dept}>
                    {dept ? dept.replace('_', ' ').charAt(0).toUpperCase() + dept.slice(1).toLowerCase() : ''}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
              <select
                value={filter.level?.[0] || ''}
                onChange={(e) => {
                  const newFilter = { ...filter };
                  if (e.target.value) {
                    newFilter.level = [e.target.value as StaffLevel];
                  } else {
                    delete newFilter.level;
                  }
                  setFilter(newFilter);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">All Levels</option>
                {Object.values(StaffLevel).map(level => (
                  <option key={level} value={level}>
                    {level ? level.replace('_', ' ').charAt(0).toUpperCase() + level.slice(1).toLowerCase() : ''}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filter.status?.[0] || ''}
                onChange={(e) => {
                  const newFilter = { ...filter };
                  if (e.target.value) {
                    newFilter.status = [e.target.value as StaffStatus];
                  } else {
                    delete newFilter.status;
                  }
                  setFilter(newFilter);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">All Statuses</option>
                {Object.values(StaffStatus).map(status => (
                  <option key={status} value={status}>
                    {status ? status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1).toLowerCase() : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Staff Display */}
      <StandardDataTable<StaffMember>
        data={filteredStaff}
        columns={tableColumns as any}
        isLoading={isLoading}
        onRowClick={(staff: StaffMember) => navigate(`/app/staff/${staff.id}`)}
        getRowKey={(staff: StaffMember) => staff.id || ''}
      />
    </div>
  );
}