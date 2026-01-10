import React, { lazy, Suspense } from 'react';
import { LucideLoader2 } from 'lucide-react';
import { ChartErrorBoundary } from './ChartErrorBoundary';
import { log } from '@/lib/logger';

// Type definitions for Recharts components
interface ChartComponentProps {
  [key: string]: unknown;
}

interface FallbackComponentProps {
  className?: string;
  children?: React.ReactNode;
}

// Dynamic chart components to avoid SSR issues with Recharts
// These components are loaded asynchronously to prevent forwardRef bundling issues
// Using safer import pattern with error handling
const createLazyChartComponent = (componentName: string) =>
  lazy(() =>
    import('recharts')
      .then((module) => {
        const component = (module as unknown as Record<string, React.ComponentType<ChartComponentProps>>)[componentName];
        if (!component) {
          throw new Error(`Component ${componentName} not found in recharts module`);
        }
        return { default: component };
      })
      .catch(error => {
        log.error(`Failed to load recharts component ${componentName}:`, { data: error }, 'DynamicChart');
        // Return a fallback component
        const FallbackComponent: React.ComponentType<FallbackComponentProps> = ({ className, children }) =>
          React.createElement('div', {
            className: className || 'p-4 text-center text-gray-500 border-2 border-dashed border-gray-300 rounded'
          }, children || `Chart component (${componentName}) failed to load`);

        return { default: FallbackComponent };
      })
  );

const LazyBarChart = createLazyChartComponent('BarChart');
const LazyBar = createLazyChartComponent('Bar');
const LazyLineChart = createLazyChartComponent('LineChart');
const LazyLine = createLazyChartComponent('Line');
const LazyPieChart = createLazyChartComponent('PieChart');
const LazyPie = createLazyChartComponent('Pie');
const LazyCell = createLazyChartComponent('Cell');
const LazyXAxis = createLazyChartComponent('XAxis');
const LazyYAxis = createLazyChartComponent('YAxis');
const LazyCartesianGrid = createLazyChartComponent('CartesianGrid');
const LazyTooltip = createLazyChartComponent('Tooltip');
const LazyResponsiveContainer = createLazyChartComponent('ResponsiveContainer');
const LazyLegend = createLazyChartComponent('Legend');

// Loading spinner component
const ChartLoader = () => (
  <div className="flex items-center justify-center h-64 w-full">
    <LucideLoader2 className="h-8 w-8 animate-spin text-blue-500" />
    <span className="ml-2 text-[var(--ff-text-secondary)]">Loading chart...</span>
  </div>
);

// Wrapper components with error boundaries and better error handling
export const DynamicBarChart: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={<ChartLoader />}>
      <LazyBarChart {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicBar: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={null}>
      <LazyBar {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicLineChart: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={<ChartLoader />}>
      <LazyLineChart {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicLine: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={null}>
      <LazyLine {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicPieChart: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={<ChartLoader />}>
      <LazyPieChart {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicPie: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={null}>
      <LazyPie {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicCell: React.FC<any> = (props) => (
  <Suspense fallback={null}>
    <LazyCell {...props} />
  </Suspense>
);

export const DynamicXAxis: React.FC<any> = (props) => (
  <Suspense fallback={null}>
    <LazyXAxis {...props} />
  </Suspense>
);

export const DynamicYAxis: React.FC<any> = (props) => (
  <Suspense fallback={null}>
    <LazyYAxis {...props} />
  </Suspense>
);

export const DynamicCartesianGrid: React.FC<any> = (props) => (
  <Suspense fallback={null}>
    <LazyCartesianGrid {...props} />
  </Suspense>
);

export const DynamicTooltip: React.FC<any> = (props) => (
  <Suspense fallback={null}>
    <LazyTooltip {...props} />
  </Suspense>
);

export const DynamicResponsiveContainer: React.FC<any> = (props) => (
  <ChartErrorBoundary>
    <Suspense fallback={<ChartLoader />}>
      <LazyResponsiveContainer {...props} />
    </Suspense>
  </ChartErrorBoundary>
);

export const DynamicLegend: React.FC<any> = (props) => (
  <Suspense fallback={null}>
    <LazyLegend {...props} />
  </Suspense>
);

// Re-export for easier imports
export {
  DynamicBarChart as BarChart,
  DynamicBar as Bar,
  DynamicLineChart as LineChart,
  DynamicLine as Line,
  DynamicPieChart as PieChart,
  DynamicPie as Pie,
  DynamicCell as Cell,
  DynamicXAxis as XAxis,
  DynamicYAxis as YAxis,
  DynamicCartesianGrid as CartesianGrid,
  DynamicTooltip as Tooltip,
  DynamicResponsiveContainer as ResponsiveContainer,
  DynamicLegend as Legend
};