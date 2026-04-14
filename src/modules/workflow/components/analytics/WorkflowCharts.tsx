// 🟢 WORKING: Interactive workflow charts and visualizations
import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from '@/components/ui/DynamicChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Progress } from '@/shared/components/ui/Progress';
import { WorkflowAnalytics } from '../../types/workflow.types';
import { TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';

interface WorkflowChartsProps {
  analytics: WorkflowAnalytics | null;
  dateRange: {
    from: string;
    to: string;
    label: string;
  };
}

const COLORS = {
  primary: '#8B5CF6',
  secondary: '#06B6D4',
  success: '#10B981',
  warning: '#D97706',
  error: '#EF4444',
  info: '#3B82F6',
  neutral: '#6B7280'
};

const PIE_COLORS = [
  COLORS.primary,
  COLORS.secondary,
  COLORS.success,
  COLORS.warning,
  COLORS.info,
  '#EC4899',
  '#C2410C',
  '#84CC16'
];

export function WorkflowCharts({ analytics, dateRange }: WorkflowChartsProps) {
  const chartData = useMemo(() => {
    if (!analytics) return null;

    // Template usage chart data
    const templateUsageData = analytics.templateUsage
      .slice(0, 10) // Top 10 templates
      .map(template => ({
        name: template.templateName.length > 15 
          ? `${template.templateName.substring(0, 15)}...`
          : template.templateName,
        fullName: template.templateName,
        projects: template.projectCount,
        duration: Math.round(template.averageDuration),
        successRate: Math.round(template.successRate)
      }));

    // Phase bottleneck data
    const bottleneckData = analytics.phaseMetrics
      .filter(phase => phase.completionRate < 90)
      .sort((a, b) => a.completionRate - b.completionRate)
      .slice(0, 8)
      .map(phase => ({
        name: phase.phaseName.length > 12 
          ? `${phase.phaseName.substring(0, 12)}...`
          : phase.phaseName,
        fullName: phase.phaseName,
        completionRate: Math.round(phase.completionRate),
        duration: Math.round(phase.averageDuration),
        risk: phase.bottleneckRisk
      }));

    // Success rate distribution
    const successRateData = analytics.templateUsage.map(template => ({
      name: template.templateName.length > 10
        ? `${template.templateName.substring(0, 10)}...`
        : template.templateName,
      fullName: template.templateName,
      rate: Math.round(template.successRate),
      projects: template.projectCount
    }));

    // Phase duration comparison
    const phaseDurationData = analytics.phaseMetrics
      .sort((a, b) => b.averageDuration - a.averageDuration)
      .slice(0, 8)
      .map(phase => ({
        name: phase.phaseName.length > 12
          ? `${phase.phaseName.substring(0, 12)}...`
          : phase.phaseName,
        fullName: phase.phaseName,
        duration: Math.round(phase.averageDuration),
        completionRate: Math.round(phase.completionRate)
      }));

    return {
      templateUsage: templateUsageData,
      bottlenecks: bottleneckData,
      successRates: successRateData,
      phaseDurations: phaseDurationData
    };
  }, [analytics]);

  if (!analytics || !chartData) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-4 bg-secondary rounded w-1/3 mb-4"></div>
                <div className="h-64 bg-secondary rounded"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label, labelKey: _labelKey = 'name' }: { active?: boolean; payload?: { name: string; value: number; color: string; payload: { fullName?: string } }[]; label?: string; labelKey?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card p-3 border rounded-lg shadow-lg">
          <p className="font-medium text-foreground">
            {payload[0]?.payload.fullName || label}
          </p>
          {payload.map((entry, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {`${entry.name}: ${entry.value}${
                entry.name.includes('Rate') ? '%' : 
                entry.name.includes('Duration') ? ' days' : ''
              }`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Projects</p>
                <p className="text-2xl font-bold">{analytics.performanceMetrics.totalProjects}</p>
              </div>
              <div className="text-blue-600 dark:text-blue-400">
                <CheckCircle className="w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Average Duration</p>
                <p className="text-2xl font-bold">
                  {Math.round(analytics.performanceMetrics.averageProjectDuration)} days
                </p>
              </div>
              <div className="text-green-600 dark:text-green-400">
                <TrendingUp className="w-6 h-6" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">On-Time Rate</p>
                <p className="text-2xl font-bold">
                  {Math.round(analytics.performanceMetrics.onTimeCompletion)}%
                </p>
              </div>
              <div className={`${
                analytics.performanceMetrics.onTimeCompletion >= 80 
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-yellow-600 dark:text-yellow-400'
              }`}>
                {analytics.performanceMetrics.onTimeCompletion >= 80 ? (
                  <TrendingUp className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Template Usage Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart className="w-5 h-5" />
              Template Usage
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Project count by template ({dateRange.label})
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.templateUsage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="projects" fill={COLORS.primary} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Success Rate Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              Success Rate Distribution
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Template success rates comparison
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData.successRates.slice(0, 6)}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name: _name, rate }: { name: string; rate: number }) => `${rate}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="rate"
                >
                  {chartData.successRates.slice(0, 6).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  content={({ payload }: { payload?: Array<{ payload: Record<string, unknown> }> }) => {
                    if (payload && payload.length) {
                      const data = payload[0]!.payload;
                      return (
                        <div className="bg-card p-3 border rounded-lg shadow-lg">
                          <p className="font-medium text-foreground">
                            {data.fullName as string}
                          </p>
                          <p className="text-sm">Success Rate: {data.rate as string | number}%</p>
                          <p className="text-sm">Projects: {data.projects as string | number}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Phase Duration Analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AreaChart className="w-5 h-5" />
              Phase Duration Analysis
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Average duration by workflow phase
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData.phaseDurations}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="duration" 
                  stroke={COLORS.secondary}
                  fill={COLORS.secondary}
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bottleneck Analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Bottleneck Analysis
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Phases with completion rates below 90%
            </p>
          </CardHeader>
          <CardContent>
            {chartData.bottlenecks.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-2" />
                <p className="text-muted-foreground">
                  No significant bottlenecks detected
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {chartData.bottlenecks.map((phase, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-foreground">
                        {phase.fullName}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={phase.completionRate < 70 ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {phase.completionRate}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {phase.duration}d avg
                        </span>
                      </div>
                    </div>
                    <Progress 
                      value={phase.completionRate} 
                      className="h-2"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Common Bottlenecks Summary */}
      {analytics.performanceMetrics.commonBottlenecks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Common Bottlenecks</CardTitle>
            <p className="text-sm text-muted-foreground">
              Most frequently reported workflow obstacles
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analytics.performanceMetrics.commonBottlenecks.map((bottleneck, index) => (
                <Badge key={index} variant="outline" className="text-sm">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {bottleneck}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}