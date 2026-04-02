/**
 * Shared Reporting Components
 *
 * Export all reusable components for the reporting dashboard
 */

export { ReportCard, ReportCardGrid } from './ReportCard';
export type {
  ReportCardProps,
  ReportCardColor,
  TrendDirection,
  ReportCardGridProps,
} from './ReportCard';

// Re-export from canonical shared location
export { TrendChart, FunnelChart, GaugeChart } from '@/components/ui/charts';
export type {
  TrendChartProps,
  ChartType,
  ChartSeries,
  FunnelChartProps,
  FunnelStage,
  GaugeChartProps,
} from '@/components/ui/charts';
