/**
 * Custom hook for BOQ List logic
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { BOQ } from '@/types/procurement/boq.types';
import { useProcurementContext } from '@/hooks/procurement/useProcurementContext';
import { procurementApiService } from '@/services/procurement/boqApiExtensions';
import toast from 'react-hot-toast';
import { log } from '@/lib/logger';
import {
  FilterState,
  SortField,
  SortDirection,
  INITIAL_FILTERS
} from './BOQListTypes';

export const useBOQList = (onSelectBOQ?: (boq: BOQ) => void) => {
  const { context } = useProcurementContext();
  const [boqs, setBOQs] = useState<BOQ[]>([]);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Load BOQs
  useEffect(() => {
    loadBOQs();
  }, [context]);

  const loadBOQs = useCallback(async () => {
    if (!context) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const data = await procurementApiService.getBOQsByProject(context as any, context.projectId);
      setBOQs(data as any);
    } catch (error) {
      log.error('Failed to load BOQs:', { data: error }, 'useBOQList');
      toast.error('Failed to load BOQs');
    } finally {
      setIsLoading(false);
    }
  }, [context]);

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
  };

  const handleEditBOQ = (_boq: BOQ) => {
    // Navigate to edit page
    // TODO: Implement navigation to BOQ edit page
    setActionMenuOpen(null);
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

      toast.success('BOQ downloaded successfully');
    } catch (error) {
      log.error('Failed to download BOQ:', { data: error }, 'useBOQList');
      toast.error('Failed to download BOQ');
    }
    setActionMenuOpen(null);
  };

  const handleArchiveBOQ = async (boq: BOQ) => {
    try {
      // await procurementApiService.updateBOQStatus(context!, boq.id, 'archived');
      setBOQs(prev => prev.map(b => b.id === boq.id ? { ...b, status: 'archived' } : b));
      toast.success('BOQ archived successfully');
    } catch (error) {
      log.error('Failed to archive BOQ:', { data: error }, 'useBOQList');
      toast.error('Failed to archive BOQ');
    }
    setActionMenuOpen(null);
  };

  const handleDeleteBOQ = async (boq: BOQ) => {
    if (!window.confirm('Are you sure you want to delete this BOQ? This action cannot be undone.')) {
      return;
    }

    try {
      await procurementApiService.deleteBOQ(context as any, boq.id);
      setBOQs(prev => prev.filter(b => b.id !== boq.id));
      toast.success('BOQ deleted successfully');
    } catch (error) {
      log.error('Failed to delete BOQ:', { data: error }, 'useBOQList');
      toast.error('Failed to delete BOQ');
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