/**
 * Type definitions for BOQ List components
 */

import { BOQ, BOQStatusType, MappingStatusType } from '@/types/procurement/boq.types';

export interface BOQListProps {
  onSelectBOQ?: (boq: BOQ) => void;
  onCreateBOQ?: () => void;
  onUploadBOQ?: () => void;
  selectedBOQId?: string;
  className?: string;
  projectId?: string;
}

export interface FilterState {
  search: string;
  status: BOQStatusType | '';
  mappingStatus: MappingStatusType | '';
  uploadedBy: string;
  dateRange: 'all' | '7days' | '30days' | '90days';
}

export type SortField = 'createdAt' | 'version' | 'itemCount' | 'mappingProgress' | 'status';
export type SortDirection = 'asc' | 'desc';

export const INITIAL_FILTERS: FilterState = {
  search: '',
  status: '',
  mappingStatus: '',
  uploadedBy: '',
  dateRange: 'all'
};

export const BOQ_STATUS_LABELS = {
  draft: 'Draft',
  uploaded: 'Uploaded',
  mapping: 'Mapping',
  mapped: 'Mapped',
  approved: 'Approved',
  archived: 'Archived',
  superseded: 'Superseded'
};

export const BOQ_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  uploaded: 'bg-blue-500/20 text-blue-400',
  mapping: 'bg-yellow-500/20 text-yellow-400',
  mapped: 'bg-green-500/20 text-green-400',
  approved: 'bg-green-500/20 text-green-400',
  archived: 'bg-gray-500/20 text-gray-400',
  mapping_review: 'bg-orange-500/20 text-orange-400',
  superseded: 'bg-gray-500/10 text-gray-500'
};

export const MAPPING_STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  mapped: 'Mapped',
  exception: 'Exception'
};

export const MAPPING_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  mapped: 'bg-green-500/20 text-green-400',
  exception: 'bg-red-500/20 text-red-400',
  completed: 'bg-green-500/20 text-green-400'
};