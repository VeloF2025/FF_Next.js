// 🟢 WORKING: Advanced performance metrics dashboard with KPI analysis
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Progress } from '@/shared/components/ui/Progress';
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Clock, 
 
  AlertTriangle,
  CheckCircle,
  Zap,
  Award,
  Activity,
  BarChart3
} from 'lucide-react';
import { WorkflowAnalytics } from '../../types/workflow.types';

interface PerformanceMetricsProps {
  analytics: WorkflowAnalytics | null;
  dateRange: {
    from: string;
    to: string;
    label: string;
  };
}

interface MetricCard {
  title: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down' | 'stable';
  target?: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  description: string;
}

export function PerformanceMetrics({ analytics, dateRange }: PerformanceMetricsProps) {
  const metrics = useMemo(() => {
    if (!analytics) return [];

    const onTimeRate = analytics.performanceMetrics.onTimeCompletion;
    const avgDuration = analytics.performanceMetrics.averageProjectDuration;
    const totalProjects = analytics.performanceMetrics.totalProjects;
    
    // Calculate template efficiency (success rate weighted by usage)
    const templateEfficiency = analytics.templateUsage.length > 0
      ? analytics.templateUsage.reduce((acc, template) => 
          acc + (template.successRate * template.projectCount), 0
        ) / analytics.templateUsage.reduce((acc, template) => 
          acc + template.projectCount, 0
        )
      : 0;

    // Calculate phase completion variance
    const phaseCompletionRates = analytics.phaseMetrics.map(p => p.completionRate);
    const avgPhaseCompletion = phaseCompletionRates.length > 0
      ? phaseCompletionRates.reduce((a, b) => a + b, 0) / phaseCompletionRates.length
      : 0;

    // Calculate workflow complexity score
    const avgPhasesPerTemplate = analytics.templateUsage.length > 0 
      ? analytics.phaseMetrics.length / analytics.templateUsage.length 
      : 0;

    const metricsData: MetricCard[] = [
      {
        title: 'On-Time Completion',
        value: `${Math.round(onTimeRate)}%`,
        target: 85,
        trend: onTimeRate >= 85 ? 'up' : onTimeRate >= 70 ? 'stable' : 'down',
        icon: Target,
        color: onTimeRate >= 85 ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400',
        bgColor: onTimeRate >= 85 ? 'bg-green-100 dark:bg-green-900/20' : 'bg-yellow-100 dark:bg-yellow-900/20',
        description: 'Projects completed within planned timeline'
      },
      {
        title: 'Average Duration',
        value: `${Math.round(avgDuration)} days`,
        trend: avgDuration <= 30 ? 'up' : avgDuration <= 60 ? 'stable' : 'down',
        icon: Clock,
        color: avgDuration <= 30 ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400',
        bgColor: avgDuration <= 30 ? 'bg-green-100 dark:bg-green-900/20' : 'bg-blue-100 dark:bg-blue-900/20',
        description: 'Average time from start to completion'
      },
      {
        title: 'Template Efficiency',
        value: `${Math.round(templateEfficiency)}%`,
        target: 90,
        trend: templateEfficiency >= 90 ? 'up' : templateEfficiency >= 75 ? 'stable' : 'down',
        icon: Zap,
        color: 'text-purple-600 dark:text-purple-400',
        bgColor: 'bg-purple-100 dark:bg-purple-900/20',
        description: 'Weighted success rate across all templates'
      },
      {
        title: 'Active Projects',
        value: totalProjects,
        trend: totalProjects > 0 ? 'up' : 'stable',
        icon: Activity,
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-100 dark:bg-blue-900/20',
        description: `Total projects in ${dateRange.label.toLowerCase()}`
      },
      {
        title: 'Phase Completion',
        value: `${Math.round(avgPhaseCompletion)}%`,
        target: 95,
        trend: avgPhaseCompletion >= 95 ? 'up' : avgPhaseCompletion >= 85 ? 'stable' : 'down',
        icon: CheckCircle,
        color: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-100 dark:bg-green-900/20',
        description: 'Average completion rate across all phases'
      },
      {
        title: 'Workflow Complexity',
        value: `${Math.round(avgPhasesPerTemplate * 10) / 10}`,
        trend: avgPhasesPerTemplate <= 5 ? 'up' : avgPhasesPerTemplate <= 8 ? 'stable' : 'down',
        icon: BarChart3,
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-100 dark:bg-orange-900/20',
        description: 'Average phases per workflow template'
      }
    ];

    return metricsData;
  }, [analytics, dateRange]);

  const topPerformers = useMemo(() => {
    if (!analytics) return [];

    return analytics.templateUsage
      .filter(template => template.projectCount >= 2)
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5)
      .map(template => ({
        name: template.templateName,
        successRate: Math.round(template.successRate),
        projects: template.projectCount,
        avgDuration: Math.round(template.averageDuration)
      }));
  }, [analytics]);

  const improvementAreas = useMemo(() => {
    if (!analytics) return [];

    const areas: Array<{
      type: string;
      name: string;
      issue: string;
      priority: 'high' | 'medium' | 'low';
      value: number;
      recommendation?: string;
    }> = [];

    // Low completion rate phases
    const problematicPhases = analytics.phaseMetrics
      .filter(phase => phase.completionRate < 80)
      .sort((a, b) => a.completionRate - b.completionRate)
      .slice(0, 3);

    problematicPhases.forEach(phase => {
      areas.push({
        type: 'Phase',
        name: phase.phaseName,
        issue: `Low completion rate: ${Math.round(phase.completionRate)}%`,
        priority: phase.completionRate < 60 ? 'high' : 'medium',
        value: phase.completionRate,
        recommendation: `Review and optimize ${phase.phaseName} workflow steps`
      });
    });

    // Slow templates
    const slowTemplates = analytics.templateUsage
      .filter(template => template.averageDuration > analytics.performanceMetrics.averageProjectDuration * 1.5)
      .sort((a, b) => b.averageDuration - a.averageDuration)
      .slice(0, 3);

    slowTemplates.forEach(template => {
      areas.push({
        type: 'Template',
        name: template.templateName,
        issue: `Above average duration: ${Math.round(template.averageDuration)} days`,
        priority: template.averageDuration > analytics.performanceMetrics.averageProjectDuration * 2 ? 'high' : 'medium',
        value: template.averageDuration,
        recommendation: 'Consider streamlining phases or improving resource allocation'
      });
    });

    return areas.slice(0, 5);
  }, [analytics]);

  if (!analytics) {
    return (
      <div className="space-y-6">
        {/* Loading skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse">
                  <div className="h-4 bg-secondary rounded w-1/2 mb-2"></div>
                  <div className="h-6 bg-secondary rounded w-1/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      default:
        return <Activity className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-100 dark:bg-red-900/20';
      case 'medium':
        return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/20';
      default:
        return 'text-blue-600 bg-blue-100 dark:bg-blue-900/20';
    }
  };

  return (
    <div className="space-y-6">
      {/* Key Performance Indicators */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Key Performance Indicators
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map((metric, index) => {
            const Icon = metric.icon;
            const progressValue = metric.target 
              ? Math.min((parseFloat(metric.value.toString()) / metric.target) * 100, 100)
              : 0;

            return (
              <Card key={index}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">
                        {metric.title}
                      </p>
                      <p className="text-2xl font-bold text-foreground">
                        {metric.value}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {metric.description}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${metric.bgColor}`}>
                        <Icon className={`w-5 h-5 ${metric.color}`} />
                      </div>
                      {getTrendIcon(metric.trend)}
                    </div>
                  </div>
                  
                  {metric.target && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Target: {metric.target}%</span>
                        <span>{Math.round(progressValue)}%</span>
                      </div>
                      <Progress value={progressValue} className="h-2" />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Top Performing Templates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-yellow-600" />
              Top Performing Templates
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Highest success rates with sufficient usage
            </p>
          </CardHeader>
          <CardContent>
            {topPerformers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Award className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No templates with sufficient data</p>
              </div>
            ) : (
              <div className="space-y-4">
                {topPerformers.map((template, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-input/50 rounded-lg">
                    <div className="flex-1">
                      <p className="font-medium text-foreground">
                        {template.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {template.projects} projects • {template.avgDuration} days avg
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={template.successRate >= 90 ? 'default' : 'secondary'}
                        className="font-semibold"
                      >
                        {template.successRate}%
                      </Badge>
                      {index === 0 && (
                        <Award className="w-4 h-4 text-yellow-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Improvement Areas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Improvement Opportunities
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Areas that could benefit from optimization
            </p>
          </CardHeader>
          <CardContent>
            {improvementAreas.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50 text-green-600" />
                <p>All metrics within acceptable ranges</p>
              </div>
            ) : (
              <div className="space-y-4">
                {improvementAreas.map((area, index) => (
                  <div key={index} className="p-3 border border-border rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" size="sm">
                            {area.type}
                          </Badge>
                          <Badge 
                            className={`text-xs ${getPriorityColor(area.priority)}`}
                            variant="secondary"
                          >
                            {area.priority} priority
                          </Badge>
                        </div>
                        <p className="font-medium text-sm text-foreground">
                          {area.name}
                        </p>
                        <p className="text-xs text-muted-foreground mb-1">
                          {area.issue}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground italic">
                      💡 {area.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Summary ({dateRange.label})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {analytics.templateUsage.length}
              </p>
              <p className="text-sm text-muted-foreground">Active Templates</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {analytics.phaseMetrics.length}
              </p>
              <p className="text-sm text-muted-foreground">Workflow Phases</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {analytics.performanceMetrics.mostUsedTemplates.length}
              </p>
              <p className="text-sm text-muted-foreground">Popular Templates</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {improvementAreas.filter(area => area.priority === 'high').length}
              </p>
              <p className="text-sm text-muted-foreground">High Priority Issues</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}