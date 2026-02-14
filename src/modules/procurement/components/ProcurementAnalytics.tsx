import { TrendingUp, DollarSign, Clock, CheckCircle } from 'lucide-react';
import { useBOQs } from '../hooks/useBOQ';
import { useRFQs } from '../hooks/useRFQ';
import { BOQStatus, RFQStatus } from '@/types/procurement.types';

export function ProcurementAnalytics() {
  const { data: boqs } = useBOQs();
  const { data: rfqs } = useRFQs();

  // Calculate metrics
  const metrics = {
    boq: {
      total: boqs?.length || 0,
      draft: boqs?.filter(b => b.status === BOQStatus.DRAFT).length || 0,
      approved: boqs?.filter(b => b.status === BOQStatus.APPROVED).length || 0,
      totalValue: boqs?.reduce((sum, b) => sum + (b.totalEstimatedValue || 0), 0) || 0,
      averageValue: boqs && boqs.length > 0 
        ? boqs.reduce((sum, b) => sum + (b.totalEstimatedValue || 0), 0) / boqs.length 
        : 0,
    },
    rfq: {
      total: rfqs?.length || 0,
      sent: rfqs?.filter(r => r.status === RFQStatus.ISSUED).length || 0,
      responsesReceived: rfqs?.filter(r => r.status === RFQStatus.RESPONSES_RECEIVED).length || 0,
      awarded: rfqs?.filter(r => r.status === RFQStatus.AWARDED).length || 0,
      responseRate: rfqs && rfqs.length > 0 
        ? (rfqs.filter(r => r.respondedSuppliers && r.respondedSuppliers.length > 0).length / rfqs.length) * 100 
        : 0,
    },
    efficiency: {
      approvalRate: boqs && boqs.length > 0 
        ? (boqs.filter(b => b.status === BOQStatus.APPROVED).length / boqs.length) * 100 
        : 0,
      awardRate: rfqs && rfqs.length > 0 
        ? (rfqs.filter(r => r.status === RFQStatus.AWARDED).length / rfqs.length) * 100 
        : 0,
    },
  };

  const kpiCards = [
    {
      title: 'Total BOQ Value',
      value: `R ${metrics.boq.totalValue.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      change: '+12%',
      changeType: 'positive',
    },
    {
      title: 'Active RFQs',
      value: metrics.rfq.sent,
      icon: Clock,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      description: 'Awaiting responses',
    },
    {
      title: 'Response Rate',
      value: `${metrics.rfq.responseRate.toFixed(0)}%`,
      icon: TrendingUp,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
      change: '+5%',
      changeType: 'positive',
    },
    {
      title: 'Approval Rate',
      value: `${metrics.efficiency.approvalRate.toFixed(0)}%`,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      description: 'BOQ approval rate',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Procurement Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Performance metrics and insights for procurement operations
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.title} className="bg-card rounded-lg border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2 rounded-lg ${kpi.bgColor}`}>
                  <Icon className={`h-6 w-6 ${kpi.color}`} />
                </div>
                {kpi.change && (
                  <span className={`text-sm font-medium ${
                    kpi.changeType === 'positive' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {kpi.change}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-medium text-muted-foreground">{kpi.title}</h3>
              <p className="text-2xl font-bold text-foreground mt-1">{kpi.value}</p>
              {kpi.description && (
                <p className="text-xs text-muted-foreground mt-1">{kpi.description}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Status Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* BOQ Status */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">BOQ Status Distribution</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Draft</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-secondary rounded-full h-2">
                  <div
                    className="bg-yellow-500 h-2 rounded-full"
                    style={{ width: `${(metrics.boq.draft / metrics.boq.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground">{metrics.boq.draft}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Approved</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-secondary rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full"
                    style={{ width: `${(metrics.boq.approved / metrics.boq.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground">{metrics.boq.approved}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RFQ Status */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">RFQ Status Distribution</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sent</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-secondary rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${(metrics.rfq.sent / metrics.rfq.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground">{metrics.rfq.sent}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Responses Received</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-secondary rounded-full h-2">
                  <div
                    className="bg-yellow-500 h-2 rounded-full"
                    style={{ width: `${(metrics.rfq.responsesReceived / metrics.rfq.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground">{metrics.rfq.responsesReceived}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Awarded</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-secondary rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full"
                    style={{ width: `${(metrics.rfq.awarded / metrics.rfq.total) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-foreground">{metrics.rfq.awarded}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Summary Statistics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Average BOQ Value</p>
            <p className="text-xl font-bold text-foreground">
              R {metrics.boq.averageValue.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total BOQs</p>
            <p className="text-xl font-bold text-foreground">{metrics.boq.total}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total RFQs</p>
            <p className="text-xl font-bold text-foreground">{metrics.rfq.total}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Award Rate</p>
            <p className="text-xl font-bold text-foreground">
              {metrics.efficiency.awardRate.toFixed(0)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}