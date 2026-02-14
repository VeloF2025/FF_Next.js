/**
 * Type definitions for BOQ History components
 */

import { BOQItem } from '@/types/procurement/boq.types';

export interface BOQHistoryProps {
  boqId: string;
  onVersionSelect?: (version: BOQVersion) => void;
  onRestore?: (version: BOQVersion) => void;
  className?: string;
}

export interface BOQVersion {
  id: string;
  boqId: string;
  version: string;
  createdAt: Date;
  createdBy: string;
  changeType: 'created' | 'updated' | 'imported' | 'mapped' | 'approved' | 'archived';
  description?: string;
  itemCount: number;
  mappedItems: number;
  exceptionsCount: number;
  changes?: ChangeRecord[];
  metadata?: Record<string, unknown>;
}

export interface ChangeRecord {
  id: string;
  type: 'item_added' | 'item_removed' | 'item_modified' | 'mapping_changed' | 'status_changed';
  itemId?: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  description: string;
  timestamp: Date;
  userId: string;
}

export interface VersionComparison {
  fromVersion: BOQVersion;
  toVersion: BOQVersion;
  changes: {
    added: BOQItem[];
    removed: BOQItem[];
    modified: Array<{
      item: BOQItem;
      changes: Array<{
        field: string;
        oldValue: unknown;
        newValue: unknown;
      }>;
    }>;
  };
}

export interface FilterState {
  search: string;
  changeType: string;
  dateRange: 'all' | '7days' | '30days' | '90days';
  user: string;
}

export const INITIAL_FILTERS: FilterState = {
  search: '',
  changeType: '',
  dateRange: 'all',
  user: ''
};

export const CHANGE_TYPE_LABELS = {
  created: 'Created',
  updated: 'Updated',
  imported: 'Imported',
  mapped: 'Mapped',
  approved: 'Approved',
  archived: 'Archived'
};

export const CHANGE_TYPE_COLORS = {
  created: 'bg-green-100 text-green-800',
  updated: 'bg-blue-100 text-blue-800',
  imported: 'bg-purple-100 text-purple-800',
  mapped: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
};

export const CHANGE_RECORD_TYPE_LABELS = {
  item_added: 'Item Added',
  item_removed: 'Item Removed',
  item_modified: 'Item Modified',
  mapping_changed: 'Mapping Changed',
  status_changed: 'Status Changed'
};