/**
 * RFQ List Component
 * Main container for displaying and managing all RFQs
 */

import { useState, useEffect } from 'react';
import { Loader2, FileText, Plus } from 'lucide-react';
import { log } from '@/lib/logger';

interface RFQ {
  id: string;
  title: string;
  description?: string;
  status: 'draft' | 'active' | 'closed' | 'expired';
  createdAt: string;
  dueDate?: string;
  projectId?: string;
  supplierCount?: number;
  responseCount?: number;
}

interface RFQListProps {
  onCreateRFQ?: () => void;
  onSelectRFQ?: (rfq: RFQ) => void;
  selectedRFQId?: string;
  className?: string;
  rfqs?: RFQ[];
  onView?: (id: string) => void;
  onEdit?: (id: string) => void;
}

export default function RFQList({
  onCreateRFQ,
  onSelectRFQ,
  selectedRFQId,
  className,
  rfqs: externalRfqs = [],
  onView,
  onEdit
}: RFQListProps) {
  const [rfqs, setRfqs] = useState<RFQ[]>(externalRfqs);
  const [isLoading, setIsLoading] = useState(externalRfqs.length === 0);

  useEffect(() => {
    if (externalRfqs.length === 0) {
      loadRFQs();
    } else {
      setRfqs(externalRfqs);
      setIsLoading(false);
    }
  }, [externalRfqs]);

  const loadRFQs = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/procurement/rfq');
      if (!response.ok) {
        throw new Error('Failed to fetch RFQs');
      }
      const data = await response.json();

      // Transform API response to match component's RFQ interface
      const transformedRfqs: RFQ[] = (data.rfqs || []).map((rfq: any) => ({
        id: rfq.id,
        title: rfq.title,
        description: rfq.description || '',
        status: rfq.status === 'open' ? 'active' : rfq.status,
        createdAt: rfq.createdDate || rfq.createdAt,
        dueDate: rfq.dueDate,
        projectId: rfq.projectId,
        supplierCount: rfq.suppliers?.length || 0,
        responseCount: rfq.quotesReceived || 0
      }));

      setRfqs(transformedRfqs);
    } catch (error) {
      log.error('Error loading RFQs', { error }, 'RFQList');
      setRfqs([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: RFQ['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400';
      case 'draft':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'closed':
        return 'bg-gray-500/20 text-gray-400';
      case 'expired':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toISOString().split('T')[0];
  };

  const handleRFQClick = (rfq: RFQ) => {
    if (onSelectRFQ) {
      onSelectRFQ(rfq);
    }
    if (onView) {
      onView(rfq.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading RFQs...</span>
      </div>
    );
  }

  // Calculate statistics
  const stats = {
    total: rfqs.length,
    draft: rfqs.filter(r => r.status === 'draft').length,
    active: rfqs.filter(r => r.status === 'active').length,
    closed: rfqs.filter(r => r.status === 'closed').length,
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">
            Request for Quotations ({rfqs.length})
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Manage and track your RFQ requests
          </p>
        </div>
        {onCreateRFQ && (
          <button
            onClick={onCreateRFQ}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create RFQ
          </button>
        )}
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Total RFQs</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</p>
            </div>
            <FileText className="h-8 w-8 text-[var(--ff-text-tertiary)]" />
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Draft</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.draft}</p>
            </div>
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <FileText className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Active</p>
              <p className="text-2xl font-bold text-green-400">{stats.active}</p>
            </div>
            <div className="p-2 bg-green-500/20 rounded-lg">
              <FileText className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Closed</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.closed}</p>
            </div>
            <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
              <FileText className="h-6 w-6 text-[var(--ff-text-tertiary)]" />
            </div>
          </div>
        </div>
      </div>

      {/* RFQ Cards Grid */}
      {rfqs.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {rfqs.map(rfq => (
            <div
              key={rfq.id}
              onClick={() => handleRFQClick(rfq)}
              className={`bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)] hover:shadow-lg transition-shadow cursor-pointer ${
                selectedRFQId === rfq.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              {/* Card Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(rfq.status)}`}>
                      {rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {rfq.title}
                  </h3>
                </div>
                {onEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(rfq.id);
                    }}
                    className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded-md hover:bg-[var(--ff-bg-hover)]"
                  >
                    Edit
                  </button>
                )}
              </div>

              {/* Description */}
              {rfq.description && (
                <p className="text-sm text-[var(--ff-text-secondary)] mb-4 line-clamp-2">
                  {rfq.description}
                </p>
              )}

              {/* Details */}
              <div className="space-y-2 text-sm text-[var(--ff-text-secondary)]">
                <div className="flex items-center justify-between">
                  <span>Created:</span>
                  <span className="text-[var(--ff-text-primary)]">{formatDate(rfq.createdAt)}</span>
                </div>
                {rfq.dueDate && (
                  <div className="flex items-center justify-between">
                    <span>Due:</span>
                    <span className="text-[var(--ff-text-primary)]">{formatDate(rfq.dueDate)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Suppliers:</span>
                  <span className="text-[var(--ff-text-primary)]">{rfq.supplierCount || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Responses:</span>
                  <span className="text-[var(--ff-text-primary)]">{rfq.responseCount || 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <FileText className="mx-auto h-12 w-12 text-[var(--ff-text-tertiary)]" />
          <h3 className="mt-4 text-lg font-medium text-[var(--ff-text-primary)]">No RFQs Found</h3>
          <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">
            No RFQs have been created for this project yet.
          </p>
          {onCreateRFQ && (
            <div className="mt-6">
              <button
                onClick={onCreateRFQ}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Create Your First RFQ
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}