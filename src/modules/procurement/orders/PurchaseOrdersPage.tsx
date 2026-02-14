import React, { useState, useEffect } from 'react';
import {
  Plus,
  Filter,
  Download,
  FileText,
  Truck,
  AlertCircle,
  DollarSign,
  TrendingUp,
  Clock
} from 'lucide-react';
import {
  StandardModuleHeader,
  StandardSummaryCards,
  StandardDataTable,
  VelocityButton,
  GlassCard,
  LoadingSpinner,
  StatusBadge,
  type TableColumn
} from '../../../components/ui';
import type { 
  POListItem, 
  POStats, 
  POFilters,
  POStatus
} from '../../../types/procurement/po.types';
import { poService } from '../../../services/procurement/poService';

const PurchaseOrdersPage: React.FC = () => {
  const [pos, setPOs] = useState<POListItem[]>([]);
  const [stats, setStats] = useState<POStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<POFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  
  // Load data
  useEffect(() => {
    loadData();
  }, [filters]);
  
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [posData, statsData] = await Promise.all([
        poService.getAllPOs({ ...filters, searchTerm }),
        poService.getPOStats()
      ]);
      
      setPOs(posData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSearch = (term: string) => {
    setSearchTerm(term);
    loadData();
  };
  
  const formatCurrency = (amount: number, currency: string = 'ZAR') => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };
  
  const formatDate = (date: Date | undefined) => {
    if (!date) return '-';
    // Standard YYYY-MM-DD format
    return new Date(date).toISOString().split('T')[0];
  };
  
  // Table columns configuration
  const columns: TableColumn<POListItem>[] = [
    {
      key: 'poNumber',
      header: 'PO Number',
      render: (po: POListItem) => (
        <div className="font-medium text-blue-400 hover:text-blue-300">
          {po.poNumber}
        </div>
      )
    },
    {
      key: 'title',
      header: 'Title',
      render: (po: POListItem) => (
        <div>
          <div className="font-medium text-[var(--ff-text-primary)]">{po.title}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">{po.supplier.name}</div>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (po: POListItem) => (
        <div className="space-y-1">
          <StatusBadge status={po.status} />
          <StatusBadge status={po.approvalStatus} />
        </div>
      )
    },
    {
      key: 'delivery',
      header: 'Delivery',
      render: (po: POListItem) => (
        <div className="text-sm">
          <div className="flex items-center space-x-1">
            <Truck className="h-3 w-3" />
            <StatusBadge status={po.deliveryStatus} />
          </div>
          <div className="text-[var(--ff-text-secondary)] mt-1">
            {formatDate(po.expectedDeliveryDate)}
          </div>
        </div>
      )
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (po: POListItem) => (
        <div className="text-right">
          <div className="font-medium">
            {formatCurrency(po.totalAmount, po.currency)}
          </div>
          <div className="text-sm text-[var(--ff-text-secondary)]">
            {po.itemCount} items
          </div>
        </div>
      )
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (po: POListItem) => {
        const deliveredPct = po.itemCount > 0 ? (po.deliveredItemCount / po.itemCount) * 100 : 0;
        const invoicedPct = po.itemCount > 0 ? (po.invoicedItemCount / po.itemCount) * 100 : 0;

        return (
          <div className="space-y-1">
            <div className="flex items-center space-x-1 text-xs">
              <div className="w-12 bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                <div
                  className="bg-green-400 h-2 rounded-full"
                  style={{ width: `${deliveredPct}%` }}
                />
              </div>
              <span className="text-[var(--ff-text-secondary)]">{Math.round(deliveredPct)}%</span>
            </div>
            <div className="flex items-center space-x-1 text-xs">
              <div className="w-12 bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                <div
                  className="bg-blue-400 h-2 rounded-full"
                  style={{ width: `${invoicedPct}%` }}
                />
              </div>
              <span className="text-[var(--ff-text-secondary)]">{Math.round(invoicedPct)}%</span>
            </div>
          </div>
        );
      }
    }
  ];
  
  // Summary cards data
  const summaryCards = stats ? [
    {
      title: 'Total POs',
      label: 'Purchase Orders',
      value: stats.total.toString(),
      trend: { value: 0, isPositive: true },
      icon: FileText,
      iconColor: 'text-blue-400',
      iconBgColor: 'bg-blue-500/20'
    },
    {
      title: 'Total Value',
      label: 'Order Value',
      value: formatCurrency(stats.totalValue),
      trend: { value: 0, isPositive: true },
      icon: DollarSign,
      iconColor: 'text-green-400',
      iconBgColor: 'bg-green-500/20'
    },
    {
      title: 'On-Time Delivery',
      label: 'Delivery Performance',
      value: `${stats.onTimeDeliveries}/${stats.onTimeDeliveries + stats.lateDeliveries}`,
      trend: { value: 0, isPositive: true },
      icon: TrendingUp,
      iconColor: 'text-purple-400',
      iconBgColor: 'bg-purple-500/20'
    },
    {
      title: 'Avg Processing Time',
      label: 'Processing Days',
      value: `${stats.averageProcessingDays} days`,
      trend: { value: 0, isPositive: true },
      icon: Clock,
      iconColor: 'text-[var(--ff-text-secondary)]',
      iconBgColor: 'bg-[var(--ff-bg-tertiary)]'
    }
  ] : [];
  
  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading Purchase Orders</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <VelocityButton 
            onClick={loadData}
            variant="outline"
            size="sm"
          >
            Try Again
          </VelocityButton>
        </div>
      </div>
    );
  }
  
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <StandardModuleHeader
        title="Purchase Orders"
        description="Manage purchase orders and track deliveries"
      />
      
      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <input
            type="text"
            placeholder="Search purchase orders..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          
          <select 
            className="form-select text-sm border-border rounded-lg"
            onChange={(e) => {
              const status = e.target.value as POStatus;
              const newFilters: POFilters = { ...filters };
              if (status) {
                newFilters.status = [status];
              } else {
                delete newFilters.status;
              }
              setFilters(newFilters);
            }}
          >
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="DELIVERED">Delivered</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>
        
        <div className="flex space-x-3">
          <VelocityButton
            variant="outline"
            size="sm"
            icon={<Filter className="h-4 w-4" />}
          >
            Filters
          </VelocityButton>
          <VelocityButton
            variant="outline"
            size="sm"
            icon={<Download className="h-4 w-4" />}
          >
            Export
          </VelocityButton>
          <VelocityButton
            size="sm"
            icon={<Plus className="h-4 w-4" />}
          >
            Create PO
          </VelocityButton>
        </div>
      </div>
      
      {/* Summary Cards */}
      <StandardSummaryCards cards={summaryCards} />
      
      {/* Data Table */}
      <GlassCard>
        <StandardDataTable
          columns={columns}
          data={pos}
          isLoading={loading}
          emptyMessage="No purchase orders found"
          getRowKey={(po) => po.id}
        />
      </GlassCard>
    </div>
  );
};

export default PurchaseOrdersPage;