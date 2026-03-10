/**
 * BOQ Detail Page
 * View, edit, and manage a specific Bill of Quantities
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ArrowLeft, FileText, Calendar, Package, Edit2, Save, X,
  Trash2, Download, Loader2, XCircle, CheckCircle, Clock,
  User, Upload, ChevronDown, Eye, EyeOff, History, ArrowRight, Search, Filter,
  ShoppingCart,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import StockItemMapper from '@/components/procurement/boq/StockItemMapper';
import { BOQLifecycleKPIs } from '@/components/procurement/boq/BOQLifecycleKPIs';
import { BOQItemLinksPopover } from '@/components/procurement/boq/BOQItemLinksPopover';
import type { BOQLifecycleResponse, BOQLifecycleLine, LifecycleStatus } from '@/types/procurement/boq-lifecycle.types';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import * as XLSX from 'xlsx';

interface BOQItem {
  id: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  totalPrice: number;
  category: string;
  stockItemId: string | null;
  stockMatchMethod: string | null;
  stockMatchConfidence: number | null;
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

interface VersionInfo {
  id: string;
  version: string;
  title: string;
  status: string;
  itemCount: number;
  totalValue: number;
  createdAt: string;
}

interface ChangeEntry {
  id: string;
  boqItemId: string | null;
  action: string;
  fieldChanged: string;
  oldValue: string;
  newValue: string;
  changedByName: string;
  changeSummary: string;
  createdAt: string;
  itemCode: string | null;
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  uploaded: { label: 'Uploaded', color: 'bg-blue-500/20 text-blue-400', icon: FileText },
  mapping: { label: 'Mapping', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  mapped: { label: 'Mapped', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  archived: { label: 'Archived', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(value);

const formatDateTime = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Strip trailing zeros from numeric change values (e.g. "5.0000" → "5") */
const formatChangeValue = (value: string, field: string) => {
  if (['quantity', 'unit_price', 'total_price'].includes(field)) {
    const num = parseFloat(value);
    if (!isNaN(num)) return String(num);
  }
  return value;
};

export default function BOQDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [boq, setBoq] = useState<BOQDetail | null>(null);
  const [items, setItems] = useState<BOQItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Feature states
  const [isEditing, setIsEditing] = useState(false);
  const [editedItems, setEditedItems] = useState<Map<string, Partial<BOQItem>>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [hideZeros, setHideZeros] = useState(false);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [changeHistory, setChangeHistory] = useState<ChangeEntry[]>([]);
  const [changeCount, setChangeCount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  // NEW: Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Lifecycle tracking states
  const [showProcurement, setShowProcurement] = useState(false);
  const [lifecycleData, setLifecycleData] = useState<BOQLifecycleResponse | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  useEffect(() => {
    if (id && typeof id === 'string') {
      fetchBOQ(id);
    }
  }, [id]);

  const fetchBOQ = async (boqId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/procurement/boq/${boqId}`);
      const data = await response.json();

      if (data.success !== false && data.id) {
        setBoq(data);
        setItems(data.items || []);
        fetchVersions(data.projectId);
        fetchChangeHistory(boqId);
      } else if (data.boq) {
        setBoq(data.boq);
        setItems(data.items || []);
        if (data.boq.projectId) fetchVersions(data.boq.projectId);
        fetchChangeHistory(boqId);
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

  const fetchVersions = async (projectId: string) => {
    try {
      const res = await fetch(`/api/procurement/boq/versions?projectId=${projectId}`);
      const data = await res.json();
      if (data.data?.versions) setVersions(data.data.versions);
    } catch (err) {
      log.error('Failed to fetch versions', err);
    }
  };

  const fetchChangeHistory = async (boqId: string) => {
    try {
      const res = await fetch(`/api/procurement/boq/change-history?boqId=${boqId}`);
      const data = await res.json();
      if (data.data?.changes) {
        setChangeHistory(data.data.changes);
        setChangeCount(data.data.total || 0);
      }
    } catch (err) {
      log.error('Failed to fetch change history', err);
    }
  };

  const fetchLifecycle = async (boqId: string) => {
    setLifecycleLoading(true);
    try {
      const res = await fetch(`/api/procurement/boq-lifecycle?boqId=${boqId}`);
      const json = await res.json() as { success: boolean; data?: BOQLifecycleResponse; error?: { message: string } };
      if (json.success && json.data) {
        setLifecycleData(json.data);
      } else {
        log.error('Failed to load lifecycle data', { error: json.error?.message }, 'BOQDetailPage');
        notificationService.error(json.error?.message || 'Failed to load procurement data');
      }
    } catch (err) {
      log.error('Failed to fetch lifecycle', err);
      notificationService.error('Failed to load procurement data');
    } finally {
      setLifecycleLoading(false);
    }
  };

  const handleToggleProcurement = () => {
    const next = !showProcurement;
    setShowProcurement(next);
    if (next && !lifecycleData && id && typeof id === 'string') {
      fetchLifecycle(id);
    }
  };

  const lifecycleMap = useMemo(() => {
    if (!lifecycleData) return new Map<string, BOQLifecycleLine>();
    const map = new Map<string, BOQLifecycleLine>();
    for (const line of lifecycleData.lines) {
      map.set(line.boqItemId, line);
    }
    return map;
  }, [lifecycleData]);

  // NEW: Debounce search term
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchTerm]);

  // NEW: Extract unique categories from items
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    items.forEach(item => {
      if (item.category && item.category.trim()) {
        categories.add(item.category);
      }
    });
    return Array.from(categories).sort();
  }, [items]);

  // NEW: Filter items based on search and category
  const filteredAndDisplayItems = useMemo(() => {
    let filtered = items;

    // Apply hideZeros filter
    if (hideZeros) {
      filtered = filtered.filter(item => item.quantity !== 0 || item.totalPrice !== 0);
    }

    // Apply search filter (search across Code and Description)
    if (debouncedSearchTerm) {
      const searchLower = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter(item => {
        const code = (item.itemCode || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        return code.includes(searchLower) || description.includes(searchLower);
      });
    }

    // Apply category filter
    if (selectedCategories.size > 0) {
      filtered = filtered.filter(item => selectedCategories.has(item.category));
    }

    return filtered;
  }, [items, hideZeros, debouncedSearchTerm, selectedCategories]);

  // Legacy name for displayItems (used in rest of component)
  const displayItems = filteredAndDisplayItems;

  const totalValue = useMemo(() =>
    displayItems.reduce((sum, item) => sum + (item.totalPrice || item.quantity * (item.unitPrice || 0)), 0),
    [displayItems]
  );

  // NEW: Calculate total value of all items (for percentage calculation)
  const allItemsTotalValue = useMemo(() =>
    items.reduce((sum, item) => sum + (item.totalPrice || item.quantity * (item.unitPrice || 0)), 0),
    [items]
  );

  // NEW: Calculate specific hidden counts for better UI feedback
  const itemsAfterZeros = items.filter(item => !hideZeros || (item.quantity !== 0 || item.totalPrice !== 0));
  const hiddenByZeros = hideZeros ? items.length - itemsAfterZeros.length : 0;
  const hiddenByAllFilters = items.length - displayItems.length;

  // NEW: Calculate filtered count
  const filteredCount = displayItems.length;
  const totalCount = hideZeros ? itemsAfterZeros.length : items.length;

  // NEW: Calculate percentage of BOQ
  const percentageOfTotal = allItemsTotalValue > 0 ? ((totalValue / allItemsTotalValue) * 100).toFixed(1) : '0.0';

  // Edit handlers
  const startEditing = () => {
    setIsEditing(true);
    setEditedItems(new Map());
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditedItems(new Map());
  };

  const updateItem = (itemId: string, field: keyof BOQItem, value: string | number) => {
    setEditedItems(prev => {
      const updated = new Map(prev);
      const existing = updated.get(itemId) || {};
      updated.set(itemId, { ...existing, [field]: value });
      return updated;
    });
  };

  const getEditValue = (item: BOQItem, field: keyof BOQItem) => {
    const edited = editedItems.get(item.id);
    if (edited && field in edited) return edited[field as keyof typeof edited];
    return item[field];
  };

  const saveEdits = async () => {
    if (!boq || editedItems.size === 0) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const updates = Array.from(editedItems.entries()).map(([itemId, changes]) => ({
        id: itemId,
        ...changes,
      }));

      const res = await fetch('/api/procurement/boq/update-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boqId: boq.id, items: updates }),
      });
      const data = await res.json();

      if (res.ok) {
        const changesLogged = data.data?.changesLogged || data.changesLogged || 0;
        notificationService.success(`${updates.length} items updated (${changesLogged} changes logged)`);
        setIsEditing(false);
        setEditedItems(new Map());
        if (id && typeof id === 'string') fetchBOQ(id);
      } else {
        notificationService.error(data.error?.message || 'Failed to save changes');
      }
    } catch (err) {
      notificationService.error('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Excel download
  // NEW: Toggle category selection
  const handleToggleCategory = (category: string) => {
    setSelectedCategories(prev => {
      const updated = new Set(prev);
      if (updated.has(category)) {
        updated.delete(category);
      } else {
        updated.add(category);
      }
      return updated;
    });
  };

  // NEW: Clear all filters
  const handleClearFilters = () => {
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setSelectedCategories(new Set());
    setShowCategoryDropdown(false);
  };

  // NEW: Check if any filters are active
  const hasActiveFilters = searchTerm.length > 0 || selectedCategories.size > 0;

  const handleExcelDownload = useCallback(() => {
    if (!boq || displayItems.length === 0) return;

    // NEW: Use filtered items instead of all items
    const wsData = displayItems.map((item, idx) => ({
      '#': item.lineNumber || idx + 1,
      'Code': item.itemCode || '',
      'Description': item.description,
      'Category': item.category || '',
      'Qty': item.quantity,
      'UOM': item.uom || 'Each',
      'Unit Price': item.unitPrice || 0,
      'Total': item.totalPrice || (item.quantity * (item.unitPrice || 0)),
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = [
      { wch: 5 }, { wch: 25 }, { wch: 50 }, { wch: 20 },
      { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOQ Items');
    const fileName = `${boq.title || 'BOQ'}_v${boq.version}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    notificationService.success(`Excel file downloaded (${displayItems.length} items)`);
  }, [boq, displayItems]);

  const handleDelete = async () => {
    if (!boq) return;
    if (!confirm('Are you sure you want to delete this BOQ? This action cannot be undone.')) return;
    try {
      const res = await fetch(`/api/procurement/boq/${boq.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success !== false) {
        notificationService.success('BOQ deleted successfully');
        router.push('/procurement/boq');
      } else {
        notificationService.error(data.error?.message || 'Failed to delete BOQ');
      }
    } catch { notificationService.error('Failed to delete BOQ'); }
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
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">{error || 'BOQ not found'}</h2>
            <Button onClick={() => router.push('/procurement/boq')}>Back to BOQ List</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const status = statusConfig[boq.status] || statusConfig.draft;
  const StatusIcon = status.icon;
  const hiddenCount = items.length - displayItems.length;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
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
                  {/* Version dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setShowVersionDropdown(!showVersionDropdown)}
                      className="flex items-center gap-1 hover:text-[var(--ff-text-primary)]"
                    >
                      Version: {boq.version}
                      {versions.length > 1 && <ChevronDown className="h-3 w-3" />}
                    </button>
                    {showVersionDropdown && versions.length > 1 && (
                      <div className="absolute top-full left-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-10 min-w-[200px]">
                        {versions.map(v => (
                          <button
                            key={v.id}
                            onClick={() => {
                              setShowVersionDropdown(false);
                              if (v.id !== boq.id) router.push(`/procurement/boq/${v.id}`);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--ff-bg-hover)] flex items-center justify-between ${
                              v.id === boq.id ? 'text-blue-400 font-medium' : 'text-[var(--ff-text-primary)]'
                            }`}
                          >
                            <span>v{v.version} - {v.title}</span>
                            {v.id === boq.id && <span className="text-xs text-blue-400">(current)</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span>|</span>
                  <span>{items.length} items</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => router.push(`/procurement/boq/new?projectId=${boq.projectId}`)}>
                  <Upload className="h-4 w-4 mr-1" />
                  Upload New Version
                </Button>
                <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-400 hover:text-red-300">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Top: Overview Cards + Summary Sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Package} label="Items" value={String(items.length)} />
                <StatCard icon={FileText} label="Total Value" value={formatCurrency(totalValue)} />
                <StatCard icon={Calendar} label="Created" value={formatDate(boq.createdAt)} />
                <StatCard icon={User} label="Uploaded By" value={boq.uploadedBy || 'System'} />
              </div>
            </div>
            <div>
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Summary</h3>
                <div className="space-y-3">
                  <SummaryRow label="Status" value={<span className={`px-2 py-1 rounded text-xs font-medium ${status.color}`}>{status.label}</span>} />
                  <SummaryRow label="Mapping Status" value={boq.mappingStatus || 'Pending'} />
                  <SummaryRow label="Version" value={boq.version} />
                  <SummaryRow label="Versions" value={`${versions.length} total`} />
                  <SummaryRow label="Last Updated" value={formatDate(boq.updatedAt)} />
                </div>
              </div>
            </div>
          </div>

          {/* Items Table - Full Width */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            {/* NEW: Enhanced Toolbar with Search and Category Filter */}
            <div className="px-6 py-4 border-b border-[var(--ff-border-light)] space-y-4">
              {/* Top row: Title and Actions */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Items ({displayItems.length}{hiddenCount > 0 ? ` of ${items.length}` : ''})
                </h3>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <Button variant="outline" size="sm" onClick={cancelEditing} disabled={isSaving}>
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveEdits} disabled={isSaving || editedItems.size === 0}>
                        {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                        Save ({editedItems.size})
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={startEditing}>
                        <Edit2 className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExcelDownload}>
                        <Download className="h-4 w-4 mr-1" />
                        Excel
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* NEW: Second row: Search, Filter, and Toggle */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <input
                    type="text"
                    placeholder="Search code or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-8 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Category Filter Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
                      selectedCategories.size > 0
                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                        : 'bg-[var(--ff-bg-primary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                    }`}
                  >
                    <Filter className="w-4 h-4" />
                    Category {selectedCategories.size > 0 && `(${selectedCategories.size})`}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showCategoryDropdown && (
                    <div className="absolute top-full right-0 mt-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-10 min-w-[200px] max-h-[300px] overflow-y-auto">
                      {availableCategories.length === 0 ? (
                        <div className="px-4 py-2 text-sm text-[var(--ff-text-tertiary)]">No categories</div>
                      ) : (
                        <>
                          <button
                            onClick={() => setSelectedCategories(new Set())}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-secondary)] border-b border-[var(--ff-border-light)]"
                          >
                            Clear All
                          </button>
                          {availableCategories.map(category => (
                            <label
                              key={category}
                              className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCategories.has(category)}
                                onChange={() => handleToggleCategory(category)}
                                className="rounded border-gray-500 bg-transparent text-blue-500 focus:ring-blue-500"
                              />
                              {category}
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Hide Zero Values Toggle */}
                <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] cursor-pointer select-none px-3 py-2 hover:text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)]">
                  <input
                    type="checkbox"
                    checked={hideZeros}
                    onChange={(e) => setHideZeros(e.target.checked)}
                    className="rounded border-gray-500 bg-transparent text-blue-500 focus:ring-blue-500"
                  />
                  {hideZeros ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  Hide zeros
                  {hiddenCount > 0 && <span className="text-xs text-yellow-400">({hiddenCount})</span>}
                </label>

                {/* Show Procurement Toggle */}
                <button
                  onClick={handleToggleProcurement}
                  className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
                    showProcurement
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                      : 'bg-[var(--ff-bg-primary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                  }`}
                >
                  {lifecycleLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                  Show Procurement
                </button>

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                  <button
                    onClick={handleClearFilters}
                    className="px-3 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
                  >
                    <X className="w-3.5 h-3.5 inline mr-1" />
                    Clear Filters
                  </button>
                )}
              </div>
            </div>

            {/* Lifecycle KPI Cards */}
            {showProcurement && lifecycleData && (
              <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                <BOQLifecycleKPIs summary={lifecycleData.summary} />
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto">
              {displayItems.length === 0 ? (
                <p className="text-center py-8 text-[var(--ff-text-secondary)]">
                  {hideZeros ? 'All items have zero values. Uncheck "Hide zero values" to see them.' : 'No items in this BOQ'}
                </p>
              ) : (
                <table className="w-full">
                  <thead className="bg-[var(--ff-bg-tertiary)]">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-12">#</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-44">Code</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide">Description</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-36">Category</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-20">Qty</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-16">UOM</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-28">Unit Price</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-32">Total</th>
                      {showProcurement && lifecycleData && (
                        <>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-purple-400 tracking-wide w-28">Ordered</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-amber-400 tracking-wide w-28">Remaining</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-green-400 tracking-wide w-28">Delivered</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-blue-400 tracking-wide w-28">Invoiced</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-emerald-400 tracking-wide w-28">Paid</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--ff-text-primary)] tracking-wide w-28">Status</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ff-border-light)]">
                    {displayItems.map((item, index) => {
                      const isItemEdited = editedItems.has(item.id);
                      return (
                        <tr key={item.id || index} className={`hover:bg-[var(--ff-bg-hover)] ${isItemEdited ? 'bg-blue-500/5' : ''}`}>
                          <td className="px-3 py-2 text-xs text-[var(--ff-text-secondary)]">
                            {item.lineNumber || index + 1}
                          </td>
                          <td className="px-3 py-2 text-sm text-[var(--ff-text-primary)] font-mono truncate max-w-[176px]" title={item.itemCode}>
                            {item.itemCode || '-'}
                          </td>
                          <td className="px-3 py-2 text-sm text-[var(--ff-text-primary)]">
                            {isEditing ? (
                              <input
                                type="text"
                                defaultValue={String(getEditValue(item, 'description'))}
                                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                className="w-full bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-2 py-1 text-sm text-[var(--ff-text-primary)]"
                              />
                            ) : (
                              <span className="truncate block max-w-md" title={item.description}>{item.description}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-[var(--ff-text-primary)] truncate max-w-[144px]" title={item.category}>
                            {item.category || '-'}
                          </td>
                          <td className="px-3 py-2 text-sm text-[var(--ff-text-primary)] text-right">
                            {isEditing ? (
                              <input
                                type="number"
                                defaultValue={Number(getEditValue(item, 'quantity'))}
                                onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                className="w-20 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-2 py-1 text-sm text-right text-[var(--ff-text-primary)]"
                              />
                            ) : (
                              item.quantity
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-[var(--ff-text-secondary)]">
                            {item.uom || 'Each'}
                          </td>
                          <td className="px-3 py-2 text-sm text-[var(--ff-text-primary)] text-right">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                defaultValue={Number(getEditValue(item, 'unitPrice'))}
                                onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                                className="w-28 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded px-2 py-1 text-sm text-right text-[var(--ff-text-primary)]"
                              />
                            ) : (
                              formatCurrency(item.unitPrice || 0)
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm font-medium text-[var(--ff-text-primary)] text-right whitespace-nowrap">
                            {formatCurrency(
                              isEditing
                                ? (Number(getEditValue(item, 'quantity')) || item.quantity) * (Number(getEditValue(item, 'unitPrice')) || item.unitPrice)
                                : item.totalPrice || (item.quantity * (item.unitPrice || 0))
                            )}
                          </td>
                          {showProcurement && lifecycleData && (() => {
                            const lc = lifecycleMap.get(item.id);
                            if (!lc) return (
                              <>
                                <td className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)] text-right">--</td>
                                <td className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)] text-right">--</td>
                                <td className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)] text-right">--</td>
                                <td className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)] text-right">--</td>
                                <td className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)] text-right">--</td>
                                <td className="px-3 py-2 text-sm text-[var(--ff-text-tertiary)]">--</td>
                              </>
                            );
                            return (
                              <>
                                <td className="px-3 py-2 text-right">
                                  {lc.orderedQty > 0 ? (
                                    <div>
                                      <div className="text-sm font-medium text-purple-400">{formatCurrency(lc.orderedValue)}</div>
                                      <div className="text-xs text-[var(--ff-text-tertiary)]">{lc.orderedQty} {lc.uom}</div>
                                      <BOQItemLinksPopover
                                        items={lc.linkedPOs.map(po => ({ id: po.id, label: po.poNumber, href: `/procurement/purchase-orders/${po.id}` }))}
                                        badgeLabel="POs"
                                        badgeColor="text-purple-400"
                                      />
                                    </div>
                                  ) : <span className="text-sm text-[var(--ff-text-tertiary)]">--</span>}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {(() => {
                                    const remaining = item.quantity - lc.orderedQty;
                                    if (lc.orderedQty === 0) return <span className="text-sm text-[var(--ff-text-tertiary)]">--</span>;
                                    return (
                                      <div>
                                        <div className={`text-sm font-medium ${remaining <= 0 ? 'text-green-400' : 'text-amber-400'}`}>
                                          {remaining <= 0 ? 'Fully ordered' : `${remaining} ${lc.uom}`}
                                        </div>
                                        {remaining > 0 && (
                                          <div className="text-xs text-[var(--ff-text-tertiary)]">
                                            {formatCurrency(remaining * (item.unitPrice || 0))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {lc.receivedQty > 0 ? (
                                    <div>
                                      <div className="text-sm font-medium text-green-400">{formatCurrency(lc.receivedValue)}</div>
                                      <div className="text-xs text-[var(--ff-text-tertiary)]">{lc.receivedQty} {lc.uom}</div>
                                      <BOQItemLinksPopover
                                        items={lc.linkedGRNs.map(grn => ({ id: grn.id, label: grn.grnNumber, href: `/procurement/grn/${grn.id}` }))}
                                        badgeLabel="GRNs"
                                        badgeColor="text-green-400"
                                      />
                                    </div>
                                  ) : <span className="text-sm text-[var(--ff-text-tertiary)]">--</span>}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {lc.invoicedValue > 0 ? (
                                    <div>
                                      <div className="text-sm font-medium text-blue-400">{formatCurrency(lc.invoicedValue)}</div>
                                      <BOQItemLinksPopover
                                        items={lc.linkedInvoices.map(inv => ({ id: inv.id, label: inv.invoiceNumber, href: `/accounting/supplier-invoices/${inv.id}` }))}
                                        badgeLabel="Invoices"
                                        badgeColor="text-blue-400"
                                      />
                                    </div>
                                  ) : <span className="text-sm text-[var(--ff-text-tertiary)]">--</span>}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {lc.paidValue > 0 ? (
                                    <div className="text-sm font-medium text-emerald-400">{formatCurrency(lc.paidValue)}</div>
                                  ) : <span className="text-sm text-[var(--ff-text-tertiary)]">--</span>}
                                </td>
                                <td className="px-3 py-2">{lifecycleStatusBadge(lc.lifecycleStatus)}</td>
                              </>
                            );
                          })()}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-[var(--ff-bg-tertiary)]">
                    <tr>
                      <td colSpan={7} className="px-3 py-3 text-sm font-semibold text-[var(--ff-text-primary)] text-right">
                        Total{hideZeros && hiddenCount > 0 ? ' (visible)' : ''}:
                      </td>
                      <td className="px-3 py-3 text-sm font-bold text-[var(--ff-text-primary)] text-right whitespace-nowrap">
                        {formatCurrency(totalValue)}
                      </td>
                      {showProcurement && lifecycleData && (
                        <>
                          <td className="px-3 py-3 text-sm font-bold text-purple-400 text-right whitespace-nowrap">
                            {formatCurrency(lifecycleData.summary.totalOrderedValue)}
                          </td>
                          <td className="px-3 py-3 text-sm font-bold text-amber-400 text-right whitespace-nowrap">
                            {formatCurrency(lifecycleData.summary.totalBoqValue - lifecycleData.summary.totalOrderedValue)}
                          </td>
                          <td className="px-3 py-3 text-sm font-bold text-green-400 text-right whitespace-nowrap">
                            {formatCurrency(lifecycleData.summary.totalReceivedValue)}
                          </td>
                          <td className="px-3 py-3 text-sm font-bold text-blue-400 text-right whitespace-nowrap">
                            {formatCurrency(lifecycleData.summary.totalInvoicedValue)}
                          </td>
                          <td className="px-3 py-3 text-sm font-bold text-emerald-400 text-right whitespace-nowrap">
                            {formatCurrency(lifecycleData.summary.totalPaidValue)}
                          </td>
                          <td />
                        </>
                      )}
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* NEW: Summary Footer */}
            {displayItems.length > 0 && (hasActiveFilters || hideZeros) && (
              <div className="px-6 py-4 border-t border-[var(--ff-border-light)] bg-blue-500/5 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-6 flex-wrap">
                  {/* Filtered Count */}
                  <div>
                    <span className="text-sm text-[var(--ff-text-secondary)]">Filtered Items:</span>
                    <span className="ml-2 text-sm font-semibold text-[var(--ff-text-primary)]">
                      {filteredCount} of {totalCount}
                    </span>
                  </div>

                  {/* Filtered Total Value */}
                  <div>
                    <span className="text-sm text-[var(--ff-text-secondary)]">Filtered Total:</span>
                    <span className="ml-2 text-sm font-semibold text-[var(--ff-text-primary)]">
                      {formatCurrency(totalValue)}
                    </span>
                  </div>

                  {/* Percentage of Total */}
                  <div>
                    <span className="text-sm text-[var(--ff-text-secondary)]">% of BOQ:</span>
                    <span className="ml-2 text-sm font-semibold text-blue-400">
                      {percentageOfTotal}%
                    </span>
                  </div>
                </div>

                {/* Clear Filters Button in Footer */}
                {hasActiveFilters && (
                  <button
                    onClick={handleClearFilters}
                    className="px-3 py-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded hover:bg-blue-500/20 transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            )}
          </div>
          {/* Stock Item Mapping */}
          <StockItemMapper
            boqId={boq.id}
            items={items.map(i => ({
              id: i.id,
              itemCode: i.itemCode,
              description: i.description,
              category: i.category,
              stockItemId: i.stockItemId,
              stockMatchMethod: i.stockMatchMethod,
              stockMatchConfidence: i.stockMatchConfidence,
            }))}
            onMappingComplete={() => { if (id && typeof id === 'string') fetchBOQ(id); }}
          />

          {/* Change History */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Change History</h3>
                {changeCount > 0 && (
                  <span className="bg-blue-500/20 text-blue-400 text-xs font-medium px-2 py-0.5 rounded-full">
                    {changeCount}
                  </span>
                )}
              </div>
              <ChevronDown className={`h-5 w-5 text-[var(--ff-text-secondary)] transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </button>

            {showHistory && (
              <div className="border-t border-[var(--ff-border-light)]">
                {changeHistory.length === 0 ? (
                  <p className="px-6 py-8 text-center text-[var(--ff-text-secondary)]">
                    No changes recorded yet. Edit items to start tracking changes.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {changeHistory.map((change) => (
                      <div key={change.id} className="px-6 py-3 flex items-start gap-4">
                        <div className="flex-shrink-0 mt-1">
                          <div className="h-2 w-2 rounded-full bg-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                              {change.changedByName}
                            </span>
                            <span className="text-xs text-[var(--ff-text-secondary)]">
                              changed <span className="font-mono text-[var(--ff-text-primary)]">{change.fieldChanged}</span>
                              {change.itemCode && (
                                <> on <span className="font-mono text-[var(--ff-text-primary)]">{change.itemCode}</span></>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs">
                            <span className="text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[200px]" title={change.oldValue}>
                              {formatChangeValue(change.oldValue, change.fieldChanged)}
                            </span>
                            <ArrowRight className="h-3 w-3 text-[var(--ff-text-secondary)] flex-shrink-0" />
                            <span className="text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded font-mono truncate max-w-[200px]" title={change.newValue}>
                              {formatChangeValue(change.newValue, change.fieldChanged)}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-[var(--ff-text-secondary)] whitespace-nowrap flex-shrink-0">
                          {formatDateTime(change.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 text-blue-400" />
        <span className="text-sm text-[var(--ff-text-secondary)]">{label}</span>
      </div>
      <p className="text-lg font-semibold text-[var(--ff-text-primary)] truncate">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--ff-text-secondary)]">{label}</span>
      <span className="text-[var(--ff-text-primary)]">{value}</span>
    </div>
  );
}

function lifecycleStatusBadge(status: LifecycleStatus) {
  const config: Record<LifecycleStatus, { label: string; classes: string }> = {
    not_started: { label: 'Not Started', classes: 'text-[var(--ff-text-tertiary)]' },
    ordered: { label: 'Ordered', classes: 'text-purple-400' },
    partially_delivered: { label: 'Part Delivered', classes: 'text-yellow-400' },
    delivered: { label: 'Delivered', classes: 'text-green-400' },
    invoiced: { label: 'Invoiced', classes: 'text-blue-400' },
    partially_paid: { label: 'Part Paid', classes: 'text-amber-400' },
    paid: { label: 'Paid', classes: 'text-emerald-400' },
  };
  const c = config[status] || config.not_started;
  return <span className={`inline-flex items-center text-xs font-medium ${c.classes}`}>{c.label}</span>;
}
