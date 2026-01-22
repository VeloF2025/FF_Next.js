/**
 * BOQ Detail Page
 * View and manage a specific Bill of Quantities
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ArrowLeft,
  FileText,
  Calendar,
  Package,
  Edit2,
  Trash2,
  Download,
  Loader2,
  XCircle,
  CheckCircle,
  Clock,
  User,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';

interface BOQItem {
  id: string;
  itemCode: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  category: string;
}

interface BOQDetail {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  version: string;
  status: string;
  fileName?: string;
  itemCount: number;
  totalEstimatedValue: number;
  mappingStatus: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  items?: BOQItem[];
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  uploaded: { label: 'Uploaded', color: 'bg-blue-500/20 text-blue-400', icon: FileText },
  mapping: { label: 'Mapping', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  mapped: { label: 'Mapped', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  archived: { label: 'Archived', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
};

export default function BOQDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [boq, setBoq] = useState<BOQDetail | null>(null);
  const [items, setItems] = useState<BOQItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id && typeof id === 'string') {
      fetchBOQ(id);
    }
  }, [id]);

  const fetchBOQ = async (boqId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch BOQ details
      const response = await fetch(`/api/procurement/boq/${boqId}`);
      const data = await response.json();

      if (data.success !== false && data.id) {
        setBoq(data);
        setItems(data.items || []);
      } else if (data.boq) {
        setBoq(data.boq);
        setItems(data.items || []);
      } else {
        setError(data.error?.message || 'Failed to load BOQ');
      }
    } catch (err) {
      log.error('Failed to fetch BOQ', err);
      setError('Failed to load BOQ details');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleDelete = async () => {
    if (!boq) return;
    if (!confirm('Are you sure you want to delete this BOQ? This action cannot be undone.')) return;

    try {
      const response = await fetch(`/api/procurement/boq/${boq.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success !== false) {
        notificationService.success('BOQ deleted successfully');
        router.push('/procurement/boq');
      } else {
        notificationService.error(data.error?.message || 'Failed to delete BOQ');
      }
    } catch (err) {
      notificationService.error('Failed to delete BOQ');
    }
  };

  const handleDownload = () => {
    if (!boq) return;
    const blob = new Blob([JSON.stringify({ boq, items }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${boq.fileName || boq.title || 'boq'}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notificationService.success('BOQ downloaded');
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      </AppLayout>
    );
  }

  if (error || !boq) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
          <div className="text-center">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              {error || 'BOQ not found'}
            </h2>
            <Button onClick={() => router.push('/procurement/boq')}>
              Back to BOQ List
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const status = statusConfig[boq.status] || statusConfig.draft;
  const StatusIcon = status.icon;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-default)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <button
              onClick={() => router.push('/procurement/boq')}
              className="flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to BOQ List
            </button>

            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {boq.title || boq.fileName || 'Untitled BOQ'}
                  </h1>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>
                    <StatusIcon className="h-4 w-4" />
                    {status.label}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
                  <span>Version: {boq.version}</span>
                  <span>|</span>
                  <span>{boq.itemCount} items</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
                <Button variant="outline" size="sm" onClick={() => router.push(`/procurement/boq/${boq.id}/edit`)}>
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-400 hover:text-red-300">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content - Items Table */}
            <div className="lg:col-span-2 space-y-6">
              {/* Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <Package className="h-4 w-4" />
                    <span className="text-xs">Items</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {boq.itemCount}
                  </p>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <FileText className="h-4 w-4" />
                    <span className="text-xs">Total Value</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {formatCurrency(boq.totalEstimatedValue || 0)}
                  </p>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <Calendar className="h-4 w-4" />
                    <span className="text-xs">Created</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {formatDate(boq.createdAt)}
                  </p>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <User className="h-4 w-4" />
                    <span className="text-xs">Uploaded By</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)] truncate">
                    {boq.uploadedBy || 'System'}
                  </p>
                </div>
              </div>

              {/* Description */}
              {boq.description && (
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-6">
                  <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">Description</h3>
                  <p className="text-[var(--ff-text-primary)]">{boq.description}</p>
                </div>
              )}

              {/* Items Table */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-[var(--ff-border-default)]">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    Items ({items.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  {items.length === 0 ? (
                    <p className="text-center py-8 text-[var(--ff-text-secondary)]">No items in this BOQ</p>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-[var(--ff-bg-tertiary)]">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Code</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Description</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Category</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Qty</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Unit Price</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ff-border-default)]">
                        {items.map((item, index) => (
                          <tr key={item.id || index} className="hover:bg-[var(--ff-bg-hover)]">
                            <td className="px-4 py-3 text-sm text-[var(--ff-text-primary)] font-mono">
                              {item.itemCode || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--ff-text-primary)]">
                              {item.description}
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
                              {item.category || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--ff-text-primary)] text-right">
                              {item.quantity} {item.unit}
                            </td>
                            <td className="px-4 py-3 text-sm text-[var(--ff-text-primary)] text-right">
                              {formatCurrency(item.unitPrice || 0)}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-[var(--ff-text-primary)] text-right">
                              {formatCurrency(item.totalPrice || (item.quantity * (item.unitPrice || 0)))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-[var(--ff-bg-tertiary)]">
                        <tr>
                          <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-[var(--ff-text-primary)] text-right">
                            Total:
                          </td>
                          <td className="px-4 py-3 text-sm font-bold text-[var(--ff-text-primary)] text-right">
                            {formatCurrency(items.reduce((sum, item) => sum + (item.totalPrice || item.quantity * (item.unitPrice || 0)), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-6">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Status</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Mapping Status</span>
                    <span className="text-[var(--ff-text-primary)]">{boq.mappingStatus || 'Pending'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Version</span>
                    <span className="text-[var(--ff-text-primary)]">{boq.version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Last Updated</span>
                    <span className="text-[var(--ff-text-primary)]">{formatDate(boq.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
