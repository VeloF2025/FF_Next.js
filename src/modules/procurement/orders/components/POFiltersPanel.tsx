// ============= PO Filters Panel Component =============

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Filter, 
  Calendar,
  DollarSign,
  User,
  Package,
  RefreshCw
} from 'lucide-react';
import {
  VelocityButton,
  GlassCard
} from '../../../../components/ui';
import { ProjectQueryService } from '@/services/projects/core/projectQueryService';
import { StatusQueries } from '@/services/suppliers/status/statusQueries';
import type { 
  POFilters,
  POStatus,
  POApprovalStatus,
  PODeliveryStatus,
  POInvoiceStatus
} from '../../../../types/procurement/po.types';
import type { Project } from '@/types/project.types';
import type { Supplier } from '@/services/suppliers/status/types';
import { log } from '@/lib/logger';

interface POFiltersPanelProps {
  filters: POFilters;
  onFiltersChange: (filters: POFilters) => void;
  onClose: () => void;
}

export const POFiltersPanel: React.FC<POFiltersPanelProps> = ({
  filters,
  onFiltersChange,
  onClose
}) => {
  const [localFilters, setLocalFilters] = useState<POFilters>(filters);

  // 🟢 WORKING: Load real data from services - zero mock data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Load real data from services
  useEffect(() => {
    const loadFilterData = async () => {
      setIsLoadingData(true);
      try {
        // Load data in parallel
        const [activeSuppliers, activeProjects] = await Promise.all([
          StatusQueries.getActiveSuppliers(),
          ProjectQueryService.getActiveProjects()
        ]);
        
        setSuppliers(activeSuppliers);
        setProjects(activeProjects);
      } catch (error) {
        log.error('Error loading filter data:', { data: error }, 'POFiltersPanel');
        // Set empty arrays instead of mock data on error
        setSuppliers([]);
        setProjects([]);
      } finally {
        setIsLoadingData(false);
      }
    };

    loadFilterData();
  }, []);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const updateFilter = (key: keyof POFilters, value: unknown) => {
    setLocalFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleApplyFilters = () => {
    onFiltersChange(localFilters);
    onClose();
  };

  const handleResetFilters = () => {
    const resetFilters: POFilters = {};
    setLocalFilters(resetFilters);
    onFiltersChange(resetFilters);
    onClose();
  };





  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-foreground flex items-center">
            <Filter className="h-6 w-6 mr-2" />
            Filter Purchase Orders
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-muted-foreground p-2"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-160px)]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Project and Supplier Filters */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Project & Supplier
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Project
                  </label>
                  <select
                    value={localFilters.projectId || ''}
                    onChange={(e) => updateFilter('projectId', e.target.value || undefined)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isLoadingData}
                  >
                    <option value="">
                      {isLoadingData ? 'Loading projects...' : 'All Projects'}
                    </option>
                    {!isLoadingData && projects.map(project => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                    {!isLoadingData && projects.length === 0 && (
                      <option value="" disabled>
                        No projects available
                      </option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Supplier
                  </label>
                  <select
                    value={localFilters.supplierId || ''}
                    onChange={(e) => updateFilter('supplierId', e.target.value || undefined)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isLoadingData}
                  >
                    <option value="">
                      {isLoadingData ? 'Loading suppliers...' : 'All Suppliers'}
                    </option>
                    {!isLoadingData && suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                    {!isLoadingData && suppliers.length === 0 && (
                      <option value="" disabled>
                        No suppliers available
                      </option>
                    )}
                  </select>
                </div>
              </div>
            </GlassCard>

            {/* Date Range Filter */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Calendar className="h-5 w-5 mr-2" />
                Date Range
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={localFilters.dateRange?.start ? 
                      new Date(localFilters.dateRange.start).toISOString().split('T')[0] : 
                      ''
                    }
                    onChange={(e) => updateFilter('dateRange', {
                      ...localFilters.dateRange,
                      start: e.target.value ? new Date(e.target.value) : undefined,
                      end: localFilters.dateRange?.end
                    })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={localFilters.dateRange?.end ? 
                      new Date(localFilters.dateRange.end).toISOString().split('T')[0] : 
                      ''
                    }
                    onChange={(e) => updateFilter('dateRange', {
                      ...localFilters.dateRange,
                      start: localFilters.dateRange?.start,
                      end: e.target.value ? new Date(e.target.value) : undefined
                    })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </GlassCard>

            {/* Amount Range Filter */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <DollarSign className="h-5 w-5 mr-2" />
                Amount Range (ZAR)
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Minimum Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={localFilters.amountRange?.min || ''}
                    onChange={(e) => updateFilter('amountRange', {
                      ...localFilters.amountRange,
                      min: parseFloat(e.target.value) || undefined,
                      max: localFilters.amountRange?.max
                    })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Maximum Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={localFilters.amountRange?.max || ''}
                    onChange={(e) => updateFilter('amountRange', {
                      ...localFilters.amountRange,
                      min: localFilters.amountRange?.min,
                      max: parseFloat(e.target.value) || undefined
                    })}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="999999.99"
                  />
                </div>
              </div>
            </GlassCard>

            {/* PO Status Filter */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Package className="h-5 w-5 mr-2" />
                PO Status
              </h3>
              
              <div className="space-y-2">
                {[
                  'DRAFT',
                  'PENDING_APPROVAL',
                  'APPROVED',
                  'SENT',
                  'ACKNOWLEDGED',
                  'IN_PROGRESS',
                  'PARTIALLY_DELIVERED',
                  'DELIVERED',
                  'INVOICED',
                  'COMPLETED',
                  'CANCELLED'
                ].map((status) => (
                  <label key={status} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(localFilters.status || []).includes(status as POStatus)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateFilter('status', [...(localFilters.status || []), status as POStatus]);
                        } else {
                          updateFilter('status', (localFilters.status || []).filter(s => s !== status));
                        }
                      }}
                      className="rounded border-border text-blue-600 focus:ring-blue-500"
                    />
                    <span className="ml-2 text-sm text-muted-foreground">
                      {status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </label>
                ))}
              </div>
            </GlassCard>
          </div>

          {/* Additional Status Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            {/* Approval Status */}
            <GlassCard className="p-6">
              <h4 className="font-semibold mb-3">Approval Status</h4>
              <div className="space-y-2">
                {[
                  'NOT_REQUIRED',
                  'PENDING',
                  'IN_PROGRESS',
                  'APPROVED',
                  'REJECTED',
                  'CANCELLED'
                ].map((status) => (
                  <label key={status} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(localFilters.approvalStatus || []).includes(status as POApprovalStatus)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateFilter('approvalStatus', [...(localFilters.approvalStatus || []), status as POApprovalStatus]);
                        } else {
                          updateFilter('approvalStatus', (localFilters.approvalStatus || []).filter(s => s !== status));
                        }
                      }}
                      className="rounded border-border text-blue-600 focus:ring-blue-500"
                    />
                    <span className="ml-2 text-xs text-muted-foreground">
                      {status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </label>
                ))}
              </div>
            </GlassCard>

            {/* Delivery Status */}
            <GlassCard className="p-6">
              <h4 className="font-semibold mb-3">Delivery Status</h4>
              <div className="space-y-2">
                {[
                  'NOT_STARTED',
                  'IN_TRANSIT',
                  'PARTIALLY_DELIVERED',
                  'FULLY_DELIVERED',
                  'DELIVERY_ISSUES'
                ].map((status) => (
                  <label key={status} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(localFilters.deliveryStatus || []).includes(status as PODeliveryStatus)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateFilter('deliveryStatus', [...(localFilters.deliveryStatus || []), status as PODeliveryStatus]);
                        } else {
                          updateFilter('deliveryStatus', (localFilters.deliveryStatus || []).filter(s => s !== status));
                        }
                      }}
                      className="rounded border-border text-blue-600 focus:ring-blue-500"
                    />
                    <span className="ml-2 text-xs text-muted-foreground">
                      {status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </label>
                ))}
              </div>
            </GlassCard>

            {/* Invoice Status */}
            <GlassCard className="p-6">
              <h4 className="font-semibold mb-3">Invoice Status</h4>
              <div className="space-y-2">
                {[
                  'NOT_INVOICED',
                  'PARTIALLY_INVOICED',
                  'FULLY_INVOICED',
                  'INVOICE_DISCREPANCIES'
                ].map((status) => (
                  <label key={status} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(localFilters.invoiceStatus || []).includes(status as POInvoiceStatus)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateFilter('invoiceStatus', [...(localFilters.invoiceStatus || []), status as POInvoiceStatus]);
                        } else {
                          updateFilter('invoiceStatus', (localFilters.invoiceStatus || []).filter(s => s !== status));
                        }
                      }}
                      className="rounded border-border text-blue-600 focus:ring-blue-500"
                    />
                    <span className="ml-2 text-xs text-muted-foreground">
                      {status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </label>
                ))}
              </div>
            </GlassCard>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-background">
          <VelocityButton
            variant="outline"
            onClick={handleResetFilters}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            Reset Filters
          </VelocityButton>
          
          <div className="flex space-x-3">
            <VelocityButton
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </VelocityButton>
            <VelocityButton
              onClick={handleApplyFilters}
            >
              Apply Filters
            </VelocityButton>
          </div>
        </div>
      </div>
    </div>
  );
};