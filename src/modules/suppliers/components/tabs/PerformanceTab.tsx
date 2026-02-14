import { useState } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Award, 
  AlertTriangle, 
  CheckCircle,
  Star,
  Target,
  Calendar,
  BarChart3,
  Activity,
  Zap
} from 'lucide-react';
import { useSuppliersPortal } from '../../context/SuppliersPortalContext';
import { cn } from '@/lib/utils';

// Performance metric types
interface PerformanceMetric {
  id: string;
  name: string;
  value: number;
  target: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
  status: 'excellent' | 'good' | 'average' | 'poor';
  description: string;
}

interface PerformancePeriod {
  period: string;
  label: string;
  metrics: PerformanceMetric[];
}

// Mock performance data
const mockPerformanceData: PerformancePeriod[] = [
  {
    period: '2024-q1',
    label: 'Q1 2024',
    metrics: [
      {
        id: 'delivery_time',
        name: 'Average Delivery Time',
        value: 3.2,
        target: 5.0,
        unit: 'days',
        trend: 'up',
        trendValue: 12,
        status: 'excellent',
        description: 'Time from order confirmation to delivery'
      },
      {
        id: 'quality_score',
        name: 'Quality Score',
        value: 94.5,
        target: 90.0,
        unit: '%',
        trend: 'up',
        trendValue: 2.3,
        status: 'excellent',
        description: 'Product quality assessment score'
      },
      {
        id: 'cost_efficiency',
        name: 'Cost Efficiency',
        value: 87.2,
        target: 85.0,
        unit: '%',
        trend: 'down',
        trendValue: 1.5,
        status: 'good',
        description: 'Cost performance vs market benchmark'
      },
      {
        id: 'response_time',
        name: 'Response Time',
        value: 2.1,
        target: 4.0,
        unit: 'hours',
        trend: 'up',
        trendValue: 8.5,
        status: 'excellent',
        description: 'Average time to respond to inquiries'
      },
      {
        id: 'compliance_rate',
        name: 'Compliance Rate',
        value: 95.0,
        target: 95.0,
        unit: '%',
        trend: 'stable',
        trendValue: 0.0,
        status: 'excellent',
        description: 'Regulatory and policy compliance score'
      },
      {
        id: 'order_accuracy',
        name: 'Order Accuracy',
        value: 98.5,
        target: 95.0,
        unit: '%',
        trend: 'up',
        trendValue: 1.2,
        status: 'excellent',
        description: 'Percentage of orders fulfilled correctly'
      }
    ]
  }
];

// KPI card component
interface KPICardProps {
  metric: PerformanceMetric;
}

function KPICard({ metric }: KPICardProps) {
  const statusConfig = {
    excellent: { 
      color: 'bg-green-50 border-green-200 text-green-900',
      iconColor: 'text-green-600',
      badgeColor: 'bg-green-100 text-green-800'
    },
    good: { 
      color: 'bg-blue-50 border-blue-200 text-blue-900',
      iconColor: 'text-blue-600',
      badgeColor: 'bg-blue-100 text-blue-800'
    },
    average: { 
      color: 'bg-yellow-50 border-yellow-200 text-yellow-900',
      iconColor: 'text-yellow-600',
      badgeColor: 'bg-yellow-100 text-yellow-800'
    },
    poor: { 
      color: 'bg-red-50 border-red-200 text-red-900',
      iconColor: 'text-red-600',
      badgeColor: 'bg-red-100 text-red-800'
    }
  };

  const TrendIcon = metric.trend === 'up' ? TrendingUp : 
                   metric.trend === 'down' ? TrendingDown : Activity;

  const trendColor = metric.trend === 'up' ? 'text-green-600' : 
                    metric.trend === 'down' ? 'text-red-600' : 'text-gray-600 dark:text-gray-400';

  const statusStyle = statusConfig[metric.status];
  const isAboveTarget = metric.value >= metric.target;

  return (
    <div className={cn("p-6 rounded-lg border", statusStyle.color)}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="font-semibold text-lg">{metric.name}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{metric.description}</p>
        </div>
        <div className={cn("px-2 py-1 rounded-full text-xs font-medium", statusStyle.badgeColor)}>
          {metric.status.toUpperCase()}
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-bold">{metric.value}</span>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{metric.unit}</span>
          </div>
          
          <div className="flex items-center space-x-3 mt-2">
            <div className="flex items-center space-x-1">
              <span className="text-sm text-gray-600 dark:text-gray-400">Target:</span>
              <span className="text-sm font-medium">{metric.target}{metric.unit}</span>
              {isAboveTarget ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
              )}
            </div>
            
            <div className="flex items-center space-x-1">
              <TrendIcon className={cn("w-4 h-4", trendColor)} />
              <span className={cn("text-sm font-medium", trendColor)}>
                {metric.trendValue}%
              </span>
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="w-16 h-16 bg-white dark:bg-gray-800 bg-opacity-50 rounded-lg flex items-center justify-center">
            <Target className={cn("w-8 h-8", statusStyle.iconColor)} />
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
          <span>Progress vs Target</span>
          <span>{Math.round((metric.value / metric.target) * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div 
            className={cn("h-2 rounded-full transition-all duration-300", 
              isAboveTarget ? 'bg-green-500' : 'bg-yellow-500'
            )}
            style={{ width: `${Math.min((metric.value / metric.target) * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Performance summary component
function PerformanceSummary({ metrics }: { metrics: PerformanceMetric[] }) {
  const excellentCount = metrics.filter(m => m.status === 'excellent').length;
  const goodCount = metrics.filter(m => m.status === 'good').length;
  const averageCount = metrics.filter(m => m.status === 'average').length;
  const poorCount = metrics.filter(m => m.status === 'poor').length;
  
  const overallScore = metrics.reduce((sum, m) => {
    const score = m.status === 'excellent' ? 4 : 
                  m.status === 'good' ? 3 : 
                  m.status === 'average' ? 2 : 1;
    return sum + score;
  }, 0) / metrics.length;

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Performance Summary</h3>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-4 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-600">{excellentCount}</div>
          <div className="text-sm text-green-700">Excellent</div>
        </div>
        <div className="text-center p-4 bg-blue-50 rounded-lg">
          <div className="text-2xl font-bold text-blue-600">{goodCount}</div>
          <div className="text-sm text-blue-700">Good</div>
        </div>
        <div className="text-center p-4 bg-yellow-50 rounded-lg">
          <div className="text-2xl font-bold text-yellow-600">{averageCount}</div>
          <div className="text-sm text-yellow-700">Average</div>
        </div>
        <div className="text-center p-4 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-600">{poorCount}</div>
          <div className="text-sm text-red-700">Poor</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">{overallScore.toFixed(1)}/4.0</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Overall Performance Score</div>
        </div>
        <div className="flex items-center space-x-2">
          {overallScore >= 3.5 ? (
            <>
              <Award className="w-6 h-6 text-yellow-500" />
              <span className="text-sm font-medium text-yellow-600">Top Performer</span>
            </>
          ) : overallScore >= 2.5 ? (
            <>
              <Star className="w-6 h-6 text-blue-500" />
              <span className="text-sm font-medium text-blue-600">Good Performance</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-6 h-6 text-orange-500" />
              <span className="text-sm font-medium text-orange-600">Needs Improvement</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Performance trends component
function PerformanceTrends({ metrics }: { metrics: PerformanceMetric[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Performance Trends</h3>
      
      <div className="space-y-4">
        {metrics.map((metric) => {
          const TrendIcon = metric.trend === 'up' ? TrendingUp : 
                           metric.trend === 'down' ? TrendingDown : Activity;
          
          const trendColor = metric.trend === 'up' ? 'text-green-600' : 
                            metric.trend === 'down' ? 'text-red-600' : 'text-gray-600 dark:text-gray-400';
          
          return (
            <div key={metric.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">{metric.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{metric.value}{metric.unit}</p>
              </div>
              
              <div className="flex items-center space-x-2">
                <TrendIcon className={cn("w-4 h-4", trendColor)} />
                <span className={cn("text-sm font-medium", trendColor)}>
                  {metric.trend === 'up' ? '+' : metric.trend === 'down' ? '-' : ''}
                  {metric.trendValue}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-4 pt-4 border-t">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Trends compared to previous quarter. Green indicates improvement, red indicates decline.
        </p>
      </div>
    </div>
  );
}

// Benchmarking component
function BenchmarkingSection({ }: { metrics: PerformanceMetric[] }) {
  const benchmarkData = [
    { category: 'Delivery Performance', rank: 2, totalSuppliers: 15, score: 94.5 },
    { category: 'Quality Standards', rank: 1, totalSuppliers: 15, score: 98.2 },
    { category: 'Cost Competitiveness', rank: 4, totalSuppliers: 15, score: 87.2 },
    { category: 'Communication', rank: 1, totalSuppliers: 15, score: 96.8 }
  ];

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Industry Benchmarking</h3>
      
      <div className="space-y-4">
        {benchmarkData.map((benchmark, index) => (
          <div key={index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">{benchmark.category}</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Rank {benchmark.rank} of {benchmark.totalSuppliers}
                </span>
                {benchmark.rank <= 3 && (
                  <Award className="w-4 h-4 text-yellow-500" />
                )}
              </div>
            </div>
            
            <div className="text-right">
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{benchmark.score}%</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Industry Score</div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 pt-4 border-t bg-blue-50 p-3 rounded-lg">
        <div className="flex items-center space-x-2">
          <Zap className="w-5 h-5 text-blue-600" />
          <span className="text-sm font-medium text-blue-900">Top 3 Performer</span>
        </div>
        <p className="text-sm text-blue-700 mt-1">
          This supplier ranks in the top 3 across multiple categories in your industry.
        </p>
      </div>
    </div>
  );
}

export function PerformanceTab() {
  const { selectedSupplier } = useSuppliersPortal();
  const [selectedPeriod, setSelectedPeriod] = useState('2024-q1');

  if (!selectedSupplier) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Select a Supplier</h3>
        <p className="text-gray-600 dark:text-gray-400">
          Choose a supplier from the Company Profile tab to view their performance metrics and KPIs.
        </p>
      </div>
    );
  }

  const currentPeriod = mockPerformanceData.find(p => p.period === selectedPeriod) || mockPerformanceData[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Performance Dashboard - {selectedSupplier.name}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Comprehensive performance metrics and KPI tracking for strategic supplier evaluation
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <select
              className="border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              {mockPerformanceData.map((period) => (
                <option key={period.period} value={period.period}>
                  {period.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Performance Summary */}
      <PerformanceSummary metrics={currentPeriod.metrics} />

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {currentPeriod.metrics.map((metric) => (
          <KPICard key={metric.id} metric={metric} />
        ))}
      </div>

      {/* Performance Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PerformanceTrends metrics={currentPeriod.metrics} />
        <BenchmarkingSection metrics={currentPeriod.metrics} />
      </div>

      {/* Historical Performance */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Historical Performance</h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <BarChart3 className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p>Historical performance charts would be displayed here</p>
          <p className="text-sm mt-1">Integration with analytics service required</p>
        </div>
      </div>

      {/* Action Items */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recommended Actions</h3>
        <div className="space-y-3">
          <div className="flex items-start space-x-3 p-3 bg-green-50 rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-900">Maintain Excellence</p>
              <p className="text-sm text-green-700">Continue current quality and delivery practices</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-900">Monitor Cost Efficiency</p>
              <p className="text-sm text-yellow-700">Cost performance declined 1.5% - investigate opportunities</p>
            </div>
          </div>
          <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
            <Award className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900">Recognize Performance</p>
              <p className="text-sm text-blue-700">Consider supplier recognition for exceptional delivery times</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PerformanceTab;