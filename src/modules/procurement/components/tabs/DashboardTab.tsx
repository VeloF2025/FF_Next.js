// 🟢 WORKING: Dashboard tab component with project context awareness
import { useMemo } from 'react';
import { 
  BarChart3, 
  FileText, 
  Send, 
  ShoppingCart, 
  AlertTriangle,
  TrendingUp,
  Clock,
  Building2,
  Globe
} from 'lucide-react';
import { useRouter } from 'next/router';
import { useProcurementPortal } from '../../context/ProcurementPortalProvider';
import { ProcurementDashboard } from '../ProcurementDashboard';
import { AllProjectsOverview } from '../AllProjectsOverview';

export function DashboardTab() {
  const router = useRouter();
  const { 
    selectedProject, 
    viewMode, 
    aggregateMetrics, 
    projectSummaries,
    isLoading 
  } = useProcurementPortal();

  // Determine which dashboard view to show
  const dashboardContent = useMemo(() => {
    if (viewMode === 'all') {
      // Show aggregate view across all projects
      return (
        <AllProjectsOverview 
          aggregateMetrics={aggregateMetrics}
          projectSummaries={projectSummaries}
          navigate={(path: string) => router.push(path)}
        />
      );
    } else if (selectedProject) {
      // Show project-specific dashboard
      return (
        <ProcurementDashboard />
      );
    } else {
      // Show welcome/selection state
      return <WelcomeState />;
    }
  }, [viewMode, selectedProject, aggregateMetrics, projectSummaries, isLoading]);

  return (
    <div className="h-full bg-background">
      {dashboardContent}
    </div>
  );
}

/**
 * Welcome state when no project is selected
 */
function WelcomeState() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 w-24 h-24 bg-primary-100 rounded-full flex items-center justify-center">
          <BarChart3 className="h-12 w-12 text-primary-600" />
        </div>
        
        <h2 className="text-2xl font-bold text-foreground mb-4">
          Welcome to Procurement Portal
        </h2>
        
        <p className="text-muted-foreground mb-6">
          Select a specific project to view its procurement dashboard, or choose "All Projects" 
          to see aggregated metrics across your entire portfolio.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
          <div className="bg-card p-4 rounded-lg border border-border">
            <Building2 className="h-8 w-8 text-blue-600 mb-2 mx-auto" />
            <h3 className="font-semibold text-foreground mb-1">Single Project</h3>
            <p className="text-sm text-muted-foreground">
              Detailed view of a specific project's procurement activities
            </p>
          </div>
          
          <div className="bg-card p-4 rounded-lg border border-border">
            <Globe className="h-8 w-8 text-green-600 mb-2 mx-auto" />
            <h3 className="font-semibold text-foreground mb-1">All Projects</h3>
            <p className="text-sm text-muted-foreground">
              Aggregate metrics and overview across all active projects
            </p>
          </div>
        </div>
        
        <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-left">
              <h4 className="font-medium text-blue-900 mb-1">Quick Start</h4>
              <p className="text-sm text-blue-700">
                Use the project selector above to get started. You can switch between 
                projects and view modes at any time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Quick stats cards for project dashboard
export function QuickStatsCards({ 
  projectId: _projectId, 
  stats 
}: { 
  projectId: string; 
  stats?: {
    boqValue: number;
    activeRfqs: number;
    pendingQuotes: number;
    totalPOs: number;
  };
}) {
  const defaultStats = {
    boqValue: 0,
    activeRfqs: 0,
    pendingQuotes: 0,
    totalPOs: 0
  };

  const displayStats = stats || defaultStats;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard
        title="BOQ Value"
        value={`R${displayStats.boqValue.toLocaleString()}`}
        icon={FileText}
        color="blue"
        trend="+12.5%"
      />
      <StatCard
        title="Active RFQs"
        value={displayStats.activeRfqs.toString()}
        icon={Send}
        color="yellow"
        trend="+3"
      />
      <StatCard
        title="Pending Quotes"
        value={displayStats.pendingQuotes.toString()}
        icon={AlertTriangle}
        color="orange"
        trend="-2"
      />
      <StatCard
        title="Purchase Orders"
        value={displayStats.totalPOs.toString()}
        icon={ShoppingCart}
        color="green"
        trend="+8"
      />
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  color: 'blue' | 'yellow' | 'orange' | 'green';
  trend?: string;
}

function StatCard({ title, value, icon: Icon, color, trend }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-500 text-white',
    yellow: 'bg-yellow-500 text-white',
    orange: 'bg-orange-500 text-white',
    green: 'bg-green-500 text-white'
  };

  const trendColor = trend?.startsWith('+') ? 'text-green-600' : 'text-red-600';

  return (
    <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
        {trend && (
          <span className={`text-sm font-medium ${trendColor} flex items-center gap-1`}>
            <TrendingUp className="h-4 w-4" />
            {trend}
          </span>
        )}
      </div>
      
      <div>
        <p className="text-2xl font-bold text-foreground mb-1">{value}</p>
        <p className="text-sm text-muted-foreground">{title}</p>
      </div>
    </div>
  );
}