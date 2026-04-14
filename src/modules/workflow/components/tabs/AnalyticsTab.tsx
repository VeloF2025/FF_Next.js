// 🟢 WORKING: Comprehensive workflow analytics dashboard with advanced visualizations
import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Clock, 
  Target, 
  Calendar,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  PieChart as PieChartIcon,
  FileText
} from 'lucide-react';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/shared/components/ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/Select';
// Badge import removed - not used in current implementation
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/Tabs';
import { workflowTemplateService } from '../../services/WorkflowTemplateService';
import { WorkflowAnalytics } from '../../types/workflow.types';
import { WorkflowCharts } from '../analytics/WorkflowCharts';
import { PerformanceMetrics } from '../analytics/PerformanceMetrics';
import { TrendAnalysis } from '../analytics/TrendAnalysis';
import { ComparisonTools } from '../analytics/ComparisonTools';
import { LiveDashboard } from '../analytics/LiveDashboard';
import { ReportExporter } from '../analytics/ReportExporter';
import { useWorkflowPortal } from '../../hooks/useWorkflowPortal';
import { log } from '@/lib/logger';

interface DateRange {
  from: string;
  to: string;
  label: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0] ?? d.toISOString().substring(0, 10);
}

const DATE_RANGES: DateRange[] = [
  {
    from: toDateStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    to: toDateStr(new Date()),
    label: 'Last 7 days'
  },
  {
    from: toDateStr(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    to: toDateStr(new Date()),
    label: 'Last 30 days'
  },
  {
    from: toDateStr(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
    to: toDateStr(new Date()),
    label: 'Last 90 days'
  },
  {
    from: toDateStr(new Date(new Date().getFullYear(), 0, 1)),
    to: toDateStr(new Date()),
    label: 'Year to date'
  },
  {
    from: toDateStr(new Date(new Date().getFullYear() - 1, 0, 1)),
    to: toDateStr(new Date(new Date().getFullYear() - 1, 11, 31)),
    label: 'Last year'
  }
];

export function AnalyticsTab() {
  const { refreshTemplates } = useWorkflowPortal();
  const [analytics, setAnalytics] = useState<WorkflowAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(DATE_RANGES[1] ?? DATE_RANGES[0]!); // Default to last 30 days
  const [activeTab, setActiveTab] = useState('overview');
  const [refreshing, setRefreshing] = useState(false);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await workflowTemplateService.getTemplateAnalytics(
        dateRange.from,
        dateRange.to
      );
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
      log.error('Analytics loading error:', { data: err }, 'AnalyticsTab');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadAnalytics(),
      refreshTemplates()
    ]);
    setRefreshing(false);
  };

  const handleDateRangeChange = (newRange: string) => {
    const range = DATE_RANGES.find(r => r.label === newRange);
    if (range) {
      setDateRange(range);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [dateRange]);

  if (loading && !analytics) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <LoadingSpinner size="lg" className="mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Loading Analytics
            </h3>
            <p className="text-muted-foreground">
              Analyzing workflow data and generating insights...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">
            Analytics Error
          </h3>
          <p className="text-muted-foreground mb-6">
            {error}
          </p>
          <Button onClick={loadAnalytics} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const quickStats = analytics ? [
    {
      title: 'Total Projects',
      value: analytics.performanceMetrics.totalProjects.toString(),
      icon: Target,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-900/20'
    },
    {
      title: 'Avg Duration',
      value: `${Math.round(analytics.performanceMetrics.averageProjectDuration)} days`,
      icon: Clock,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-100 dark:bg-green-900/20'
    },
    {
      title: 'On-Time Rate',
      value: `${Math.round(analytics.performanceMetrics.onTimeCompletion)}%`,
      icon: CheckCircle,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-100 dark:bg-purple-900/20'
    },
    {
      title: 'Active Templates',
      value: analytics.templateUsage.length.toString(),
      icon: FileText,
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-100 dark:bg-orange-900/20'
    }
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Workflow Analytics
          </h2>
          <p className="text-muted-foreground mt-1">
            Comprehensive insights into workflow performance and utilization
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Select value={dateRange.label} onValueChange={handleDateRangeChange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGES.map((range) => (
                  <SelectItem key={range.label} value={range.label}>
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            onClick={handleRefresh} 
            variant="outline" 
            size="sm"
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          <ReportExporter 
            analytics={analytics}
            dateRange={dateRange}
          />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {stat.title}
                    </p>
                    <p className="text-2xl font-bold text-foreground">
                      {stat.value}
                    </p>
                  </div>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${stat.bgColor}`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Analytics Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-2 lg:grid-cols-6 gap-1">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Performance</span>
          </TabsTrigger>
          <TabsTrigger value="trends" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">Trends</span>
          </TabsTrigger>
          <TabsTrigger value="comparison" className="flex items-center gap-2">
            <PieChartIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Compare</span>
          </TabsTrigger>
          <TabsTrigger value="live" className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Live</span>
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Reports</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <WorkflowCharts 
            analytics={analytics}
            dateRange={dateRange}
          />
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <PerformanceMetrics 
            analytics={analytics}
            dateRange={dateRange}
          />
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <TrendAnalysis 
            analytics={analytics}
            dateRange={dateRange}
          />
        </TabsContent>

        <TabsContent value="comparison" className="space-y-6">
          <ComparisonTools 
            analytics={analytics}
            dateRange={dateRange}
          />
        </TabsContent>

        <TabsContent value="live" className="space-y-6">
          <LiveDashboard 
            analytics={analytics}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              Custom Reports
            </h3>
            <p className="text-muted-foreground mb-6">
              Generate custom reports with specific metrics and time ranges
            </p>
            <ReportExporter 
              analytics={analytics}
              dateRange={dateRange}
              variant="expanded"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}