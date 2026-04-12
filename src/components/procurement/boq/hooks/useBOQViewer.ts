/**
 * Custom hook for BOQ Viewer logic
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { BOQItem, BOQWithItems } from '@/types/procurement/boq.types';
import { useProcurementContext } from '@/hooks/procurement/useProcurementContext';
import { procurementApiService } from '@/services/procurement/boqApiExtensions';
import type { ProcurementApiContext } from '@/services/procurement';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import {
  FilterState,
  EditingItem,
  SortField,
  SortDirection,
  INITIAL_FILTERS,
  ITEMS_PER_PAGE,
  DEFAULT_VISIBLE_COLUMNS,
  VisibleColumns
} from '../BOQViewerTypes';

export const useBOQViewer = (
  boqId: string,
  initialMode: 'view' | 'edit' = 'view',
  onItemUpdate?: (item: BOQItem) => void
) => {
  const { context } = useProcurementContext();
  const [boqData, setBOQData] = useState<BOQWithItems | null>(null);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('lineNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [editingItems, setEditingItems] = useState<Map<string, EditingItem>>(new Map());
  const [selectedItems] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>(DEFAULT_VISIBLE_COLUMNS);

  // Load BOQ data
  useEffect(() => {
    loadBOQData();
  }, [boqId, context]);

  // Debounce search (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const loadBOQData = useCallback(async () => {
    if (!context) return;

    try {
      setIsLoading(true);
      const data = await procurementApiService.getBOQWithItems(context as unknown as ProcurementApiContext, boqId);
      setBOQData(data);
    } catch (error) {
      log.error('Failed to load BOQ data:', { data: error }, 'useBOQViewer');
      notificationService.operationError('load', error as Error, 'BOQ data');
    } finally {
      setIsLoading(false);
    }
  }, [context, boqId]);

  // Get unique filter values
  const filterOptions = useMemo(() => {
    if (!boqData) return { phases: [], categories: [] };

    const phases = [...new Set(boqData.items.map(item => item.phase).filter(Boolean))] as string[];
    const categories = [...new Set(boqData.items.map(item => item.category).filter(Boolean))] as string[];

    return { phases, categories };
  }, [boqData]);

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    if (!boqData) return [];

    const filtered = boqData.items.filter(item => {
      // Search filter (debounced)
      if (debouncedSearch) {
        const searchTerm = debouncedSearch.toLowerCase();
        if (
          !item.description.toLowerCase().includes(searchTerm) &&
          !(item.itemCode?.toLowerCase().includes(searchTerm)) &&
          !(item.category?.toLowerCase().includes(searchTerm))
        ) {
          return false;
        }
      }

      // Status filters
      if (filters.mappingStatus && item.mappingStatus !== filters.mappingStatus) return false;
      if (filters.procurementStatus && item.procurementStatus !== filters.procurementStatus) return false;
      if (filters.phase && item.phase !== filters.phase) return false;
      if (filters.categories.length > 0 && !filters.categories.includes(item.category || '')) return false;

      // Issues filter
      if (filters.hasIssues !== null) {
        const hasIssues = item.mappingStatus === 'exception' || 
                          item.mappingConfidence !== undefined && item.mappingConfidence < 70;
        if (filters.hasIssues !== hasIssues) return false;
      }

      return true;
    });

    // Sort items
    filtered.sort((a, b) => {
      let aVal: string | number, bVal: string | number;

      switch (sortField) {
        case 'lineNumber':
          aVal = a.lineNumber;
          bVal = b.lineNumber;
          break;
        case 'description':
          aVal = a.description.toLowerCase();
          bVal = b.description.toLowerCase();
          break;
        case 'quantity':
          aVal = a.quantity;
          bVal = b.quantity;
          break;
        case 'unitPrice':
          aVal = a.unitPrice || 0;
          bVal = b.unitPrice || 0;
          break;
        case 'totalPrice':
          aVal = a.totalPrice || 0;
          bVal = b.totalPrice || 0;
          break;
        case 'mappingConfidence':
          aVal = a.mappingConfidence || 0;
          bVal = b.mappingConfidence || 0;
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
  }, [boqData, debouncedSearch, filters.mappingStatus, filters.procurementStatus, filters.phase, filters.categories, filters.hasIssues, sortField, sortDirection]);

  // Paginated items
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSortedItems, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedItems.length / ITEMS_PER_PAGE);

  // Start editing an item
  const startEditing = (item: BOQItem) => {
    setEditingItems(prev => new Map(prev).set(item.id, {
      id: item.id,
      data: { ...item }
    }));
  };

  // Cancel editing
  const cancelEditing = (itemId: string) => {
    setEditingItems(prev => {
      const newMap = new Map(prev);
      newMap.delete(itemId);
      return newMap;
    });
  };

  // Update editing data
  const updateEditingItem = (itemId: string, field: keyof BOQItem, value: BOQItem[keyof BOQItem]) => {
    setEditingItems(prev => {
      const newMap = new Map(prev);
      const editing = newMap.get(itemId);
      if (editing) {
        newMap.set(itemId, {
          ...editing,
          data: { ...editing.data, [field]: value }
        });
      }
      return newMap;
    });
  };

  // Save item changes
  const saveItem = async (itemId: string) => {
    if (!context) return;

    const editingItem = editingItems.get(itemId);
    if (!editingItem) return;

    try {
      setIsSaving(true);
      
      const updatedItem = await procurementApiService.updateBOQItem(
        context as unknown as ProcurementApiContext,
        itemId,
        editingItem.data
      );

      // Update local state
      if (boqData) {
        setBOQData(prev => ({
          ...prev!,
          items: prev!.items.map(item => 
            item.id === itemId ? { ...item, ...updatedItem } : item
          )
        }));
      }

      // Clear editing state
      cancelEditing(itemId);
      
      notificationService.operationSuccess('updated', 'Item');
      onItemUpdate?.(updatedItem);
    } catch (error) {
      log.error('Failed to save item:', { data: error }, 'useBOQViewer');
      notificationService.operationError('save', error as Error, 'item');
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return {
    boqData,
    filters,
    setFilters,
    sortField,
    sortDirection,
    handleSort,
    currentPage,
    setCurrentPage,
    mode,
    setMode,
    editingItems,
    startEditing,
    cancelEditing,
    updateEditingItem,
    saveItem,
    selectedItems,
    isLoading,
    isSaving,
    showFilters,
    setShowFilters,
    visibleColumns,
    setVisibleColumns,
    loadBOQData,
    filterOptions,
    filteredAndSortedItems,
    paginatedItems,
    totalPages
  };
};