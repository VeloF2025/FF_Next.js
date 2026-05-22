import type { TimelineEntry } from '@/types/field-stock';

export interface SerialTimelineProps {
  entries: TimelineEntry[];
  hasRealEvents: boolean;
}
