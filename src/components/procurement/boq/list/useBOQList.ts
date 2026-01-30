/**
 * Custom hook for BOQ List logic
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { BOQ } from '@/types/procurement/boq.types';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import {
  FilterState,
  SortField,
  SortDirection,
  INITIAL_FILTERS
} from './BOQListTypes';

export const useBOQList = (onSelectBOQ?: (boq: BOQ) => void, projectId?: string) => {
  const [boqs, setBOQs] = useState<BOQ[]>([]);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Load BOQs directly from API
  useEffect(() => {
    loadBOQs();
  }, [projectId]);

  const loadBOQs = useCallback(async () => {
    try {
      setIsLoading(true);
      // Fetch directly from API - works with or without projectId
      const url = projectId
        ? `/api/procurement/boq?projectId=${projectId}`
        : '/api/procurement/boq';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch BOQs');
      }
      const data = await response.json();
      // API returns { boqs: [...], items: [...], stats: {...} }
      const boqData = data.boqs || [];
      // Transform to BOQ type
      const transformed: BOQ[] = boqData.map((b: any) => ({
        id: b.id,
        projectId: b.project_id,
        title: b.title || 'Untitled BOQ',
        description: b.description || '',
        version: b.version || 'V1',
        status: b.status || 'draft',
        fileName: b.file_name || b.title || 'Unknown',
        itemCount: b.item_count || b.items_count || 0,
        mappedItems: b.mapped_items_count || 0,
        unmappedItems: b.unmapped_items_count || 0,
        totalEstimatedValue: Number(b.total_estimated_value) || 0,
        mappingStatus: b.mapping_status || 'pending',
        uploadedBy: b.uploaded_by || 'System',
        createdAt: b.created_at || new Date().toISOString(),
        updatedAt: b.updated_at || new Date().toISOString(),
      }));
      setBOQs(transformed);
    } catch (error) {
      log.error('Failed to load BOQs:', { data: error }, 'useBOQList');
      notificationService.operationError('load', error as Error, 'BOQs');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Get unique filter values
  const filterOptions = useMemo(() => {
    const uploaders = [...new Set(boqs.map(boq => boq.uploadedBy).filter(Boolean))];
    return { uploaders };
  }, [boqs]);

  // Filter and sort BOQs
  const filteredAndSortedBOQs = useMemo(() => {
    const filtered = boqs.filter(boq => {
      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        if (
          !boq.title?.toLowerCase().includes(searchTerm) &&
          !boq.fileName?.toLowerCase().includes(searchTerm) &&
          !boq.description?.toLowerCase().includes(searchTerm)
        ) {
          return false;
        }
      }

      // Status filters
      if (filters.status && boq.status !== filters.status) return false;
      if (filters.mappingStatus && boq.mappingStatus !== filters.mappingStatus) return false;
      if (filters.uploadedBy && boq.uploadedBy !== filters.uploadedBy) return false;

      // Date range filter
      if (filters.dateRange !== 'all') {
        const now = new Date();
        const boqDate = new Date(boq.createdAt);
        const daysDiff = Math.floor((now.getTime() - boqDate.getTime()) / (1000 * 60 * 60 * 24));
        
        switch (filters.dateRange) {
          case '7days':
            if (daysDiff > 7) return false;
            break;
          case '30days':
            if (daysDiff > 30) return false;
            break;
          case '90days':
            if (daysDiff > 90) return false;
            break;
        }
      }

      return true;
    });

    // Sort BOQs
    filtered.sort((a, b) => {
      let aVal: any, bVal: any;

      switch (sortField) {
        case 'createdAt':
          aVal = new Date(a.createdAt).getTime();
          bVal = new Date(b.createdAt).getTime();
          break;
        case 'version':
          aVal = a.version;
          bVal = b.version;
          break;
        case 'itemCount':
          aVal = a.itemCount || 0;
          bVal = b.itemCount || 0;
          break;
        case 'mappingProgress':
          aVal = (a as any).mappingProgress || 0;
          bVal = (b as any).mappingProgress || 0;
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          return 0;
      }

      if (sortDirection === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });

    return filtered;
  }, [boqs, filters, sortField, sortDirection]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handle BOQ actions
  const handleViewBOQ = (boq: BOQ) => {
    onSelectBOQ?.(boq);
    setActionMenuOpen(null);
    // Navigate to BOQ detail page
    window.location.href = `/procurement/boq/${boq.id}`;
  };

  const handleEditBOQ = (boq: BOQ) => {
    // Navigate to edit page
    setActionMenuOpen(null);
    window.location.href = `/procurement/boq/${boq.id}/edit`;
  };

  const handleDownloadBOQ = async (boq: BOQ) => {
    try {
      // This would call an actual API endpoint
      const blob = new Blob([JSON.stringify(boq, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${boq.fileName || 'boq'}_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notificationService.operationSuccess('downloaded', 'BOQ');
    } catch (error) {
      log.error('Failed to download BOQ:', { data: error }, 'useBOQList');
      notificationService.operationError('download', error as Error, 'BOQ');
    }
    setActionMenuOpen(null);
  };

  const handleArchiveBOQ = async (boq: BOQ) => {
    try {
      // await procurementApiService.updateBOQStatus(context!, boq.id, 'archived');
      setBOQs(prev => prev.map(b => b.id === boq.id ? { ...b, status: 'archived' } : b));
      notificationService.operationSuccess('archived', 'BOQ');
    } catch (error) {
      log.error('Failed to archive BOQ:', { data: error }, 'useBOQList');
      notificationService.operationError('archive', error as Error, 'BOQ');
    }
    setActionMenuOpen(null);
  };

  const handleDeleteBOQ = async (boq: BOQ) => {
    if (!window.confirm('Are you sure you want to delete this BOQ? This action cannot be undone.')) {
      return;
    }

    try {
      // Call API directly to delete BOQ
      const response = await fetch(`/api/procurement/boq/${boq.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete BOQ');
      }
      setBOQs(prev => prev.filter(b => b.id !== boq.id));
      notificationService.operationSuccess('deleted', 'BOQ');
    } catch (error) {
      log.error('Failed to delete BOQ:', { data: error }, 'useBOQList');
      notificationService.operationError('delete', error as Error, 'BOQ');
    }
    setActionMenuOpen(null);
  };

  return {
    boqs,
    filteredAndSortedBOQs,
    filters,
    setFilters,
    sortField,
    sortDirection,
    handleSort,
    isLoading,
    showFilters,
    setShowFilters,
    actionMenuOpen,
    setActionMenuOpen,
    filterOptions,
    loadBOQs,
    handleViewBOQ,
    handleEditBOQ,
    handleDownloadBOQ,
    handleArchiveBOQ,
    handleDeleteBOQ
  };
};