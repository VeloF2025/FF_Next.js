import { useState } from 'react';
import { Plus, FileText, Clock, CheckCircle, Package } from 'lucide-react';
import { useBOQs } from '../hooks/useBOQ';
import { BOQStatus } from '@/types/procurement.types';
import { BOQCard } from '../components/BOQCard';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '@/utils/dateFormat';
import {
  StandardModuleHeader,
  StandardSummaryCards,
  StandardSearchFilter,
  StandardDataTable,
  StatusBadge
} from '@/components/ui';

export function BOQListPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<BOQStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [showFilters] = useState(false);
  
  const { data: boqs, isLoading, error } = useBOQs(
    statusFilter === 'all' 
      ? {} 
      : { status: statusFilter }
  );

  const filteredBOQs = boqs?.filter(boq => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        boq.version.toLowerCase().includes(search) ||
        boq.title?.toLowerCase().includes(search) ||
        boq.projectId?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleCreate = () => {
    navigate('/procurement/boq/new');
  };

  const handleImport = () => {
    // TODO: Implement Excel import

  };

  const handleExportAll = () => {
    // TODO: Implement bulk export

  };

  // Calculate summary statistics
  const summaryCards = boqs ? [
    {
      label: 'Total BOQs',
      value: boqs.length,
      icon: FileText,
      iconColor: 'text-blue-600',
      iconBgColor: 'bg-blue-500/20',
      trend: { value: 8, isPositive: true }
    },
    {
      label: 'Approved BOQs',
      value: boqs.filter(b => b.status === BOQStatus.APPROVED).length,
      icon: CheckCircle,
      iconColor: 'text-green-600',
      iconBgColor: 'bg-green-500/20',
      trend: { value: 5, isPositive: true }
    },
    {
      label: 'Draft BOQs',
      value: boqs.filter(b => b.status === BOQStatus.DRAFT).length,
      icon: Clock,
      iconColor: 'text-yellow-600',
      iconBgColor: 'bg-yellow-500/20',
      trend: { value: 2, isPositive: true }
    },
    {
      label: 'Total Value',
      value: `R ${boqs.reduce((sum, b) => sum + (b.totalEstimatedValue || 0), 0).toLocaleString()}`,
      icon: Package,
      iconColor: 'text-purple-600',
      iconBgColor: 'bg-purple-500/20',
      trend: { value: 12, isPositive: true }
    }
  ] : [];

  // Table columns configuration
  const tableColumns = [
    { key: 'version', header: 'Version' },
    { key: 'title', header: 'Title' },
    { key: 'projectId', header: 'Project' },
    { 
      key: 'status', 
      header: 'Status',
      render: (boq: any) => <StatusBadge status={boq.status} />
    },
    { 
      key: 'itemCount', 
      header: 'Items',
      render: (boq: any) => `${boq.itemCount || 0} items`
    },
    { 
      key: 'totalEstimatedValue', 
      header: 'Total Value',
      render: (boq: any) => boq.totalEstimatedValue ? `R ${boq.totalEstimatedValue.toLocaleString()}` : 'TBC'
    },
    { 
      key: 'createdAt', 
      header: 'Created',
      render: (boq: any) => formatDate(boq.createdAt)
    }
  ];

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Error loading BOQs: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <StandardModuleHeader
        title="Bill of Quantities"
        description="Manage project BOQs, templates, and pricing"
        itemCount={boqs?.length || 0}
        onAdd={handleCreate}
        onImport={handleImport}
        onExport={handleExportAll}
        addButtonText="Create BOQ"
        exportDisabled={!boqs || boqs.length === 0}
        addPermission="procurement.sourcing.boq"
        importPermission="procurement.sourcing.boq"
      />
      
      {/* Additional Actions */}
      <div className="flex gap-3 justify-end">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setViewMode('card')}
            className={`px-3 py-1 text-sm rounded ${viewMode === 'card' ? 'bg-blue-600 text-white' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'}`}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 text-sm rounded ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'}`}
          >
            Table
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <StandardSummaryCards cards={summaryCards} />

      {/* Search and Filters */}
      <StandardSearchFilter
        searchValue={searchTerm}
        onSearch={setSearchTerm}
        placeholder="Search BOQs by version, title, or project..."
        showFilters={true}
      />

      {/* Custom Filters */}
      {showFilters && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as BOQStatus | 'all')}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
              >
                <option value="all">All Statuses</option>
                <option value={BOQStatus.DRAFT}>Draft</option>
                <option value={BOQStatus.MAPPING_REVIEW}>Mapping Review</option>
                <option value={BOQStatus.APPROVED}>Approved</option>
                <option value={BOQStatus.ARCHIVED}>Archived</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* BOQ Display */}
      {viewMode === 'table' ? (
        <StandardDataTable
          data={filteredBOQs || []}
          columns={tableColumns}
          isLoading={isLoading}
          onRowClick={(boq: any) => navigate(`/procurement/boq/${boq.id}`)}
          getRowKey={(boq: any) => boq.id}
          emptyMessage="No BOQs found. Create your first BOQ to get started."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading && (
            <div className="col-span-full text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            </div>
          )}
          
          {filteredBOQs?.length === 0 && (
            <div className="col-span-full bg-[var(--ff-bg-secondary)] p-12 rounded-lg border border-[var(--ff-border-light)] text-center">
              <FileText className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No BOQs found</h3>
              <p className="text-[var(--ff-text-secondary)] mb-4">Get started by creating your first BOQ</p>
              <button
                onClick={handleCreate}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First BOQ
              </button>
            </div>
          )}
          
          {filteredBOQs?.map((boq) => (
            <BOQCard key={boq.id} boq={boq} />
          ))}
        </div>
      )}
    </div>
  );
}