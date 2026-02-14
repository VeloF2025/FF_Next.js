import React from 'react';
import { Search, Filter, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { StockFilter, StockSortBy } from '../types/stock.types';

interface StockFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterStatus: string;
  onFilterChange: (value: StockFilter) => void;
  sortBy: string;
  onSortChange: (value: StockSortBy) => void;
  selectedCount?: number;
  onBulkIssue?: () => void;
  onBulkTransfer?: () => void;
}

export const StockFilters: React.FC<StockFiltersProps> = ({
  searchTerm,
  onSearchChange,
  filterStatus,
  onFilterChange,
  sortBy,
  onSortChange,
  selectedCount = 0,
  onBulkIssue,
  onBulkTransfer
}) => {
  return (
    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="border border-border rounded-md px-3 py-1 text-sm w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={filterStatus}
            onChange={(e) => onFilterChange(e.target.value as StockFilter)}
            className="border border-border rounded-md px-3 py-1 text-sm"
          >
            <option value="all">All Status</option>
            <option value="in-stock">In Stock</option>
            <option value="low-stock">Low/Out of Stock</option>
            <option value="excess-stock">Excess Stock</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as StockSortBy)}
            className="border border-border rounded-md px-3 py-1 text-sm"
          >
            <option value="item-code">Item Code</option>
            <option value="description">Description</option>
            <option value="stock-level">Stock Level</option>
            <option value="value">Total Value</option>
            <option value="last-received">Last Received</option>
          </select>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
          {onBulkIssue && (
            <Button variant="outline" size="sm" onClick={onBulkIssue}>
              <ArrowRight className="h-4 w-4 mr-1" />
              Bulk Issue
            </Button>
          )}
          {onBulkTransfer && (
            <Button variant="outline" size="sm" onClick={onBulkTransfer}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Bulk Transfer
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
