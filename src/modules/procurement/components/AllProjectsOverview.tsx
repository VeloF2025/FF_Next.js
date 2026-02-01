import { 
  Building2, 
  TrendingUp, 
  Users, 
  Package, 
  DollarSign,
  Clock,
  AlertTriangle,
  BarChart3
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { 
  AggregateProjectMetrics, 
  ProjectSummary 
} from '@/types/procurement/portal.types';

interface AllProjectsOverviewProps {
  aggregateMetrics: AggregateProjectMetrics | undefined;
  projectSummaries: ProjectSummary[] | undefined;
  navigate: (path: string) => void;
}

export function AllProjectsOverview({ 
  aggregateMetrics, 
  projectSummaries,
  navigate 
}: AllProjectsOverviewProps) {
  
  if (!aggregateMetrics || !projectSummaries) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">All Projects Overview</h1>
        </div>
        <p className="text-[var(--ff-text-secondary)]">
          Organization-wide procurement insights across {aggregateMetrics.totalProjects} active projects
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Button variant="outline" onClick={() => navigate('/procurement/reports')} className="flex items-center gap-2 h-auto p-4">
          <BarChart3 className="h-5 w-5 text-blue-400" />
          <div className="text-left">
            <div className="font-medium text-[var(--ff-text-primary)]">Generate Reports</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Cross-project analytics</div>
          </div>
        </Button>
        <Button variant="outline" onClick={() => navigate('/procurement/rfq')} className="flex items-center gap-2 h-auto p-4">
          <TrendingUp className="h-5 w-5 text-green-400" />
          <div className="text-left">
            <div className="font-medium text-[var(--ff-text-primary)]">New RFQ</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Create quotation request</div>
          </div>
        </Button>
        <Button variant="outline" onClick={() => navigate('/suppliers')} className="flex items-center gap-2 h-auto p-4">
          <Users className="h-5 w-5 text-purple-400" />
          <div className="text-left">
            <div className="font-medium text-[var(--ff-text-primary)]">Manage Suppliers</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">View supplier database</div>
          </div>
        </Button>
        <Button variant="outline" onClick={() => navigate('/procurement/inventory')} className="flex items-center gap-2 h-auto p-4">
          <Package className="h-5 w-5 text-orange-400" />
          <div className="text-left">
            <div className="font-medium text-[var(--ff-text-primary)]">Stock Overview</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">Inventory management</div>
          </div>
        </Button>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Building2 className="h-5 w-5 text-blue-400" />
            </div>
            <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Total Projects</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{aggregateMetrics.totalProjects}</div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-400" />
            </div>
            <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Total BOQ Value</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
            R {aggregateMetrics.totalBOQValue.toLocaleString()}
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <TrendingUp className="h-5 w-5 text-purple-400" />
            </div>
            <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Avg Cost Savings</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{aggregateMetrics.averageCostSavings}%</div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Clock className="h-5 w-5 text-orange-400" />
            </div>
            <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Avg Cycle Time</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{aggregateMetrics.averageCycleDays} days</div>
        </div>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Active Operations</h3>
            <Package className="h-5 w-5 text-[var(--ff-text-secondary)]" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Active RFQs</span>
              <span className="font-semibold">{aggregateMetrics.totalActiveRFQs}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Purchase Orders</span>
              <span className="font-semibold">{aggregateMetrics.totalPurchaseOrders}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Stock Items</span>
              <span className="font-semibold">{aggregateMetrics.totalStockItems.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Supplier Performance</h3>
            <Users className="h-5 w-5 text-[var(--ff-text-secondary)]" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Total Suppliers</span>
              <span className="font-semibold">{aggregateMetrics.totalSuppliers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Average OTIF</span>
              <span className="font-semibold text-green-400">{aggregateMetrics.averageSupplierOTIF}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Performance Issues</span>
              <span className="font-semibold text-red-400">2</span>
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Alerts & Actions</h3>
            <AlertTriangle className="h-5 w-5 text-[var(--ff-text-secondary)]" />
          </div>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Critical Alerts</span>
              <span className="font-semibold text-red-400">{aggregateMetrics.criticalAlerts}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Pending Approvals</span>
              <span className="font-semibold text-yellow-400">{aggregateMetrics.pendingApprovals}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--ff-text-secondary)]">Completed Today</span>
              <span className="font-semibold text-green-400">24</span>
            </div>
          </div>
        </div>
      </div>

      {/* Project Summaries */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Project Summaries</h2>
          <Button
            variant="outline"
            onClick={() => navigate('/app/projects')}
          >
            View All Projects
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Project
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  BOQ Value
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Active RFQs
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Completion
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Last Activity
                </th>
              </tr>
            </thead>
            <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
              {projectSummaries.map((project) => (
                <tr key={project.id} className="hover:bg-[var(--ff-bg-hover)]">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-[var(--ff-text-primary)]">{project.name}</div>
                      <div className="text-sm text-[var(--ff-text-secondary)]">{project.code}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]">
                    R {project.boqValue.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]">
                    {project.activeRFQs}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-1 bg-[var(--ff-bg-tertiary)] rounded-full h-2 mr-2">
                        <div
                          className="bg-blue-400 h-2 rounded-full"
                          style={{ width: `${project.completionPercentage}%` }}
                        />
                      </div>
                      <span className="text-sm text-[var(--ff-text-secondary)]">{project.completionPercentage}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      project.status === 'active' ? 'bg-green-500/20 text-green-400' :
                      project.status === 'on-hold' ? 'bg-yellow-500/20 text-yellow-400' :
                      project.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
                    }`}>
                      {project.status}
                    </span>
                    {project.alertCount > 0 && (
                      <span className="ml-2 inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-500/20 text-red-400">
                        {project.alertCount} alerts
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                    {project.lastActivity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}