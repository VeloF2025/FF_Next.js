// 🟢 WORKING: Template and project comparison analysis tools
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/Select';
import { Badge } from '@/shared/components/ui/Badge';
import { Progress } from '@/shared/components/ui/Progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/Tabs';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from '@/components/ui/DynamicChart';
import {
  GitCompare,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  AlertTriangle,
  Minus
} from 'lucide-react';
import { WorkflowAnalytics, WorkflowTemplate } from '../../types/workflow.types';
import { workflowTemplateService } from '../../services/WorkflowTemplateService';
import { log } from '@/lib/logger';

interface ComparisonToolsProps {
  analytics: WorkflowAnalytics | null;
  dateRange: {
    from: string;
    to: string;
    label: string;
  };
}

interface TemplateComparison {
  template1: WorkflowTemplate;
  template2: WorkflowTemplate;
  comparison: {
    phaseCount: { template1: number; template2: number };
    avgStepsPerPhase: { template1: number; template2: number };
    avgTasksPerStep: { template1: number; template2: number };
    estimatedDuration: { template1: number; template2: number };
    complexity: { template1: string; template2: string };
    similarities: string[];
    differences: string[];
  };
}

export function ComparisonTools({ analytics, dateRange: _dateRange }: ComparisonToolsProps) {
  const [selectedTemplate1, setSelectedTemplate1] = useState<string>('');
  const [selectedTemplate2, setSelectedTemplate2] = useState<string>('');
  const [comparison, setComparison] = useState<TemplateComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('templates');

  const templates = analytics?.templateUsage || [];
  
  const performanceComparison = useMemo(() => {
    if (!analytics) return [];

    return analytics.templateUsage
      .filter(template => template.projectCount >= 2) // Only include templates with sufficient data
      .sort((a, b) => b.successRate - a.successRate)
      .map(template => ({
        name: template.templateName.length > 15 
          ? `${template.templateName.substring(0, 15)}...`
          : template.templateName,
        fullName: template.templateName,
        successRate: Math.round(template.successRate),
        avgDuration: Math.round(template.averageDuration),
        projectCount: template.projectCount,
        efficiency: Math.round((template.successRate / template.averageDuration) * 10) / 10
      }));
  }, [analytics]);

  const phaseComparison = useMemo(() => {
    if (!analytics) return [];

    return analytics.phaseMetrics
      .sort((a, b) => b.completionRate - a.completionRate)
      .map(phase => ({
        name: phase.phaseName.length > 12 
          ? `${phase.phaseName.substring(0, 12)}...`
          : phase.phaseName,
        fullName: phase.phaseName,
        completionRate: Math.round(phase.completionRate),
        avgDuration: Math.round(phase.averageDuration),
        bottleneckRisk: phase.completionRate < 80 ? 'high' : phase.completionRate < 90 ? 'medium' : 'low'
      }));
  }, [analytics]);

  const benchmarkData = useMemo(() => {
    if (!analytics) return null;

    const avgSuccessRate = analytics.templateUsage.length > 0
      ? analytics.templateUsage.reduce((sum, t) => sum + t.successRate, 0) / analytics.templateUsage.length
      : 0;

    const avgDuration = analytics.performanceMetrics.averageProjectDuration;
    const onTimeRate = analytics.performanceMetrics.onTimeCompletion;

    return {
      industry: {
        successRate: 82,
        avgDuration: 35,
        onTimeRate: 78,
        phaseCompletion: 88
      },
      current: {
        successRate: avgSuccessRate,
        avgDuration: avgDuration,
        onTimeRate: onTimeRate,
        phaseCompletion: analytics.phaseMetrics.length > 0
          ? analytics.phaseMetrics.reduce((sum, p) => sum + p.completionRate, 0) / analytics.phaseMetrics.length
          : 0
      }
    };
  }, [analytics]);

  const compareTemplates = async () => {
    if (!selectedTemplate1 || !selectedTemplate2 || selectedTemplate1 === selectedTemplate2) return;

    setLoading(true);
    try {
      const result = await workflowTemplateService.compareTemplates(selectedTemplate1, selectedTemplate2);
      setComparison(result);
    } catch (error) {
      log.error('Template comparison failed:', { data: error }, 'ComparisonTools');
    } finally {
      setLoading(false);
    }
  };

  const radarData = useMemo(() => {
    if (!benchmarkData) return [];

    return [
      {
        metric: 'Success Rate',
        current: (benchmarkData.current.successRate / benchmarkData.industry.successRate) * 100,
        industry: 100,
        fullMark: 120
      },
      {
        metric: 'Duration Efficiency',
        current: (benchmarkData.industry.avgDuration / benchmarkData.current.avgDuration) * 100,
        industry: 100,
        fullMark: 120
      },
      {
        metric: 'On-Time Rate',
        current: (benchmarkData.current.onTimeRate / benchmarkData.industry.onTimeRate) * 100,
        industry: 100,
        fullMark: 120
      },
      {
        metric: 'Phase Completion',
        current: (benchmarkData.current.phaseCompletion / benchmarkData.industry.phaseCompletion) * 100,
        industry: 100,
        fullMark: 120
      }
    ];
  }, [benchmarkData]);

  if (!analytics) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-6 bg-secondary rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-secondary rounded"></div>
        </div>
      </div>
    );
  }

  const getBenchmarkStatus = (current: number, industry: number, higherIsBetter = true) => {
    const ratio = higherIsBetter ? current / industry : industry / current;
    if (ratio >= 1.1) return { status: 'excellent', color: 'text-green-600', icon: TrendingUp };
    if (ratio >= 0.95) return { status: 'good', color: 'text-blue-600', icon: CheckCircle };
    if (ratio >= 0.8) return { status: 'average', color: 'text-yellow-600', icon: Minus };
    return { status: 'below', color: 'text-red-600', icon: TrendingDown };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Comparison & Benchmarking
        </h3>
        <p className="text-sm text-muted-foreground">
          Compare templates, analyze performance, and benchmark against industry standards
        </p>
      </div>

      {/* Comparison Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="templates">Template Comparison</TabsTrigger>
          <TabsTrigger value="performance">Performance Analysis</TabsTrigger>
          <TabsTrigger value="benchmarks">Industry Benchmarks</TabsTrigger>
        </TabsList>

        {/* Template Comparison Tab */}
        <TabsContent value="templates" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitCompare className="w-5 h-5" />
                Template Comparison
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Select two templates to compare their structure and performance
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    First Template
                  </label>
                  <Select value={selectedTemplate1} onValueChange={setSelectedTemplate1}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select first template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.templateId} value={template.templateId}>
                          {template.templateName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Second Template
                  </label>
                  <Select 
                    value={selectedTemplate2} 
                    onValueChange={setSelectedTemplate2}
                    disabled={!selectedTemplate1}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select second template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates
                        .filter(template => template.templateId !== selectedTemplate1)
                        .map((template) => (
                          <SelectItem key={template.templateId} value={template.templateId}>
                            {template.templateName}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button 
                onClick={compareTemplates}
                disabled={!selectedTemplate1 || !selectedTemplate2 || loading}
                className="w-full"
              >
                {loading ? 'Comparing...' : 'Compare Templates'}
              </Button>

              {comparison && (
                <div className="mt-6 space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Template 1 Details */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">{comparison.template1.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Phases:</span>
                          <span className="font-medium">{comparison.comparison.phaseCount.template1}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Avg Steps/Phase:</span>
                          <span className="font-medium">{comparison.comparison.avgStepsPerPhase.template1.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Avg Tasks/Step:</span>
                          <span className="font-medium">{comparison.comparison.avgTasksPerStep.template1.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Est. Duration:</span>
                          <span className="font-medium">{comparison.comparison.estimatedDuration.template1} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Complexity:</span>
                          <Badge variant="outline">{comparison.comparison.complexity.template1}</Badge>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Template 2 Details */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">{comparison.template2.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Phases:</span>
                          <span className="font-medium">{comparison.comparison.phaseCount.template2}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Avg Steps/Phase:</span>
                          <span className="font-medium">{comparison.comparison.avgStepsPerPhase.template2.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Avg Tasks/Step:</span>
                          <span className="font-medium">{comparison.comparison.avgTasksPerStep.template2.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Est. Duration:</span>
                          <span className="font-medium">{comparison.comparison.estimatedDuration.template2} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Complexity:</span>
                          <Badge variant="outline">{comparison.comparison.complexity.template2}</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Similarities and Differences */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          Similarities
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {comparison.comparison.similarities.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No significant similarities found</p>
                        ) : (
                          <ul className="space-y-2">
                            {comparison.comparison.similarities.map((similarity, index) => (
                              <li key={index} className="text-sm flex items-start gap-2">
                                <CheckCircle className="w-3 h-3 text-green-600 mt-1 flex-shrink-0" />
                                {similarity}
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-yellow-600" />
                          Key Differences
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {comparison.comparison.differences.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No significant differences found</p>
                        ) : (
                          <ul className="space-y-2">
                            {comparison.comparison.differences.map((difference, index) => (
                              <li key={index} className="text-sm flex items-start gap-2">
                                <AlertTriangle className="w-3 h-3 text-yellow-600 mt-1 flex-shrink-0" />
                                {difference}
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Analysis Tab */}
        <TabsContent value="performance" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Template Performance Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Template Performance Comparison</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Success rate vs. efficiency across templates
                </p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performanceComparison.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} fontSize={12} />
                    <YAxis />
                    <Tooltip 
                      content={({ payload }: { payload?: Array<{ payload: Record<string, unknown> }> }) => {
                        if (payload && payload.length) {
                          const data = payload[0]!.payload;
                          return (
                            <div className="bg-card p-3 border rounded-lg shadow-lg">
                              <p className="font-medium">{data.fullName as string}</p>
                              <p className="text-sm">Success Rate: {data.successRate as string | number}%</p>
                              <p className="text-sm">Projects: {data.projectCount as string | number}</p>
                              <p className="text-sm">Avg Duration: {data.avgDuration as string | number} days</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="successRate" fill="#10B981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Phase Performance Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Phase Completion Analysis</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Completion rates by workflow phase
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {phaseComparison.slice(0, 10).map((phase, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{phase.fullName}</span>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant={
                              phase.bottleneckRisk === 'high' ? 'destructive' :
                              phase.bottleneckRisk === 'medium' ? 'secondary' : 'default'
                            }
                            className="text-xs"
                          >
                            {phase.completionRate}%
                          </Badge>
                          <span className="text-xs text-muted-foreground">{phase.avgDuration}d</span>
                        </div>
                      </div>
                      <Progress value={phase.completionRate} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Industry Benchmarks Tab */}
        <TabsContent value="benchmarks" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Benchmark Radar Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Performance vs Industry Benchmarks</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Your performance compared to industry standards
                </p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis 
                      angle={90} 
                      domain={[0, 120]} 
                      tick={false}
                    />
                    <Radar
                      name="Your Performance"
                      dataKey="current"
                      stroke="#8B5CF6"
                      fill="#8B5CF6"
                      fillOpacity={0.3}
                    />
                    <Radar
                      name="Industry Average"
                      dataKey="industry"
                      stroke="#6B7280"
                      fill="#6B7280"
                      fillOpacity={0.1}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Benchmark Details */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Benchmark Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {benchmarkData && [
                  {
                    metric: 'Success Rate',
                    current: benchmarkData.current.successRate,
                    industry: benchmarkData.industry.successRate,
                    unit: '%',
                    higherIsBetter: true
                  },
                  {
                    metric: 'Average Duration',
                    current: benchmarkData.current.avgDuration,
                    industry: benchmarkData.industry.avgDuration,
                    unit: ' days',
                    higherIsBetter: false
                  },
                  {
                    metric: 'On-Time Completion',
                    current: benchmarkData.current.onTimeRate,
                    industry: benchmarkData.industry.onTimeRate,
                    unit: '%',
                    higherIsBetter: true
                  },
                  {
                    metric: 'Phase Completion',
                    current: benchmarkData.current.phaseCompletion,
                    industry: benchmarkData.industry.phaseCompletion,
                    unit: '%',
                    higherIsBetter: true
                  }
                ].map((item, index) => {
                  const status = getBenchmarkStatus(item.current, item.industry, item.higherIsBetter);
                  const Icon = status.icon;
                  
                  return (
                    <div key={index} className="flex items-center justify-between p-3 bg-input/50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{item.metric}</p>
                        <p className="text-xs text-muted-foreground">
                          Industry: {Math.round(item.industry)}{item.unit}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="font-bold">{Math.round(item.current)}{item.unit}</p>
                          <p className={`text-xs ${status.color}`}>
                            {status.status}
                          </p>
                        </div>
                        <Icon className={`w-4 h-4 ${status.color}`} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}