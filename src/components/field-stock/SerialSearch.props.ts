import type { SerialSearchFilters } from '@/types/field-stock';

export interface SerialSearchProps {
  initialFilters: SerialSearchFilters;
  onFiltersChange: (filters: SerialSearchFilters) => void;
  categories?: string[];
}
