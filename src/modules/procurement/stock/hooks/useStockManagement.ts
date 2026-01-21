import { useState, useMemo } from 'react';
import type { StockItemData, StockStats, StockFilter, StockSortBy } from '../types/stock.types';
import { log } from '@/lib/logger';

export const useStockManagement = (stockItems: StockItemData[]) => {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<StockFilter>('all');
  const [sortBy, setSortBy] = useState<StockSortBy>('item-code');
  const [searchTerm, setSearchTerm] = useState('');

  // Filter and sort stock items
  const filteredItems = useMemo(() => {
    let filtered = stockItems;

    // Filter by status
    if (filterStatus !== 'all') {
      if (filterStatus === 'low-stock') {
        filtered = filtered.filter(item => item.status === 'low-stock' || item.status === 'out-of-stock');
      } else {
        filtered = filtered.filter(item => item.status === filterStatus);
      }
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(item =>
        item.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sort items
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'item-code':
          return a.itemCode.localeCompare(b.itemCode);
        case 'description':
          return a.description.localeCompare(b.description);
        case 'stock-level':
          return b.currentStock - a.currentStock;
        case 'value':
          return b.totalValue - a.totalValue;
        case 'last-received':
          if (!a.lastReceived || !b.lastReceived) return 0;
          return b.lastReceived.getTime() - a.lastReceived.getTime();
        default:
          return 0;
      }
    });

    return filtered;
  }, [stockItems, filterStatus, sortBy, searchTerm]);

  // Calculate statistics
  const stats: StockStats = useMemo(() => ({
    totalItems: stockItems.length,
    totalValue: stockItems.reduce((sum, item) => sum + item.totalValue, 0),
    lowStock: stockItems.filter(item => item.status === 'low-stock').length,
    outOfStock: stockItems.filter(item => item.status === 'out-of-stock').length
  }), [stockItems]);

  const handleToggleSelect = (itemId: string, checked: boolean) => {
    if (checked) {
      setSelectedItems([...selectedItems, itemId]);
    } else {
      setSelectedItems(selectedItems.filter(id => id !== itemId));
    }
  };

  const handleBulkAction = (action: string) => {
    if (selectedItems.length === 0) return;
    // Implement bulk action logic
    log.info(`Bulk ${action} for items`, { selectedItems, module: 'procurement:stock' });
  };

  const handleStockAction = (itemId: string, action: string) => {
    // Implement stock action logic
    log.info(`${action} for item`, { itemId, module: 'procurement:stock' });
  };

  return {
    // State
    selectedItems,
    filterStatus,
    sortBy,
    searchTerm,
    // Computed
    filteredItems,
    stats,
    // Actions
    setSearchTerm,
    setFilterStatus,
    setSortBy,
    handleToggleSelect,
    handleBulkAction,
    handleStockAction
  };
};
