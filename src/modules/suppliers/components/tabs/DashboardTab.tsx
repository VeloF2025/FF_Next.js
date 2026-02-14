import React from 'react';
import { 
  Users, 
  TrendingUp, 
  CheckCircle, 
  Clock, 
  MessageSquare, 
  FileText,
  AlertTriangle,
  Building2,
  Star,
  Activity
} from 'lucide-react';
import { useSuppliersPortal } from '../../context/SuppliersPortalContext';
import { cn } from '@/lib/utils';

// Stats card component
interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}

function StatsCard({ title, value, icon: Icon, trend, color }: StatsCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200'
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</p>
          {trend && (
            <div className="flex items-center mt-2">
              <TrendingUp 
                className={cn("h-4 w-4 mr-1", 
                  trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
                )} 
              />
              <span className={cn("text-sm font-medium",
                trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
              )}>
                {trend.value}%
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-1">vs last month</span>
            </div>
          )}
        </div>
        <div className={cn("p-3 rounded-lg border", colorClasses[color])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

// Quick actions component
function QuickActions() {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        <button className="p-3 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors">
          <Building2 className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Add New Supplier</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Register a new supplier</p>
        </button>
        <button className="p-3 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors">
          <FileText className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Create RFQ</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Send request for quote</p>
        </button>
        <button className="p-3 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors">
          <MessageSquare className="h-5 w-5 text-purple-600 mb-2" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Send Message</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Contact suppliers</p>
        </button>
        <button className="p-3 text-left border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors">
          <Activity className="h-5 w-5 text-orange-600 mb-2" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">View Reports</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Supplier analytics</p>
        </button>
      </div>
    </div>
  );
}

// Recent activity component
function RecentActivity() {
  const activities = [
    {
      id: 1,
      type: 'rfq_sent',
      supplier: 'TechFlow Solutions',
      message: 'RFQ sent for Network Equipment',
      time: '2 hours ago',
      icon: FileText,
      color: 'blue'
    },
    {
      id: 2,
      type: 'quote_received',
      supplier: 'Global Materials Inc',
      message: 'Quote received for Steel Components',
      time: '4 hours ago',
      icon: CheckCircle,
      color: 'green'
    },
    {
      id: 3,
      type: 'compliance_due',
      supplier: 'Premium Services Ltd',
      message: 'Compliance documentation due',
      time: '6 hours ago',
      icon: AlertTriangle,
      color: 'yellow'
    },
    {
      id: 4,
      type: 'message_received',
      supplier: 'TechFlow Solutions',
      message: 'New message received',
      time: '8 hours ago',
      icon: MessageSquare,
      color: 'purple'
    }
  ];

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    purple: 'bg-purple-100 text-purple-600'
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Activity</h3>
      <div className="space-y-4">
        {activities.map((activity) => {
          const Icon = activity.icon;
          return (
            <div key={activity.id} className="flex items-start space-x-3">
              <div className={cn("p-2 rounded-lg flex-shrink-0", colorClasses[activity.color])}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{activity.message}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{activity.supplier}</p>
                <p className="text-xs text-gray-400 mt-1">{activity.time}</p>
              </div>
            </div>
          );
        })}
      </div>
      <button className="w-full mt-4 px-4 py-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
        View All Activity
      </button>
    </div>
  );
}

// Top suppliers component
function TopSuppliers() {
  const { suppliers } = useSuppliersPortal();

  const topSuppliers = suppliers
    .filter(s => s.status === 'active')
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Top Performing Suppliers</h3>
      <div className="space-y-4">
        {topSuppliers.map((supplier, index) => (
          <div key={supplier.id} className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                  index === 0 ? "bg-yellow-100 text-yellow-800" :
                  index === 1 ? "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200" :
                  index === 2 ? "bg-orange-100 text-orange-800" :
                  "bg-blue-100 text-blue-800"
                )}>
                  {index + 1}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{supplier.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{supplier.category}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Star className="h-4 w-4 text-yellow-500 fill-current" />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{supplier.rating}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">({supplier.complianceScore}% compliance)</span>
            </div>
          </div>
        ))}
      </div>
      <button className="w-full mt-4 px-4 py-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
        View All Suppliers
      </button>
    </div>
  );
}

export function DashboardTab() {
  const { allSuppliersStats, selectedSupplier } = useSuppliersPortal();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {selectedSupplier ? `${selectedSupplier.name} Dashboard` : 'Suppliers Overview'}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {selectedSupplier 
              ? `Comprehensive view of ${selectedSupplier.name} performance and activities`
              : 'Monitor and manage all supplier relationships from a unified dashboard'
            }
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Total Suppliers"
          value={allSuppliersStats.totalSuppliers}
          icon={Building2}
          trend={{ value: 12, direction: 'up' }}
          color="blue"
        />
        <StatsCard
          title="Active Suppliers"
          value={allSuppliersStats.activeSuppliers}
          icon={Users}
          trend={{ value: 8, direction: 'up' }}
          color="green"
        />
        <StatsCard
          title="Average Rating"
          value={allSuppliersStats.averageRating.toFixed(1)}
          icon={Star}
          trend={{ value: 3, direction: 'up' }}
          color="yellow"
        />
        <StatsCard
          title="Compliance Rate"
          value={`${allSuppliersStats.complianceRate.toFixed(0)}%`}
          icon={CheckCircle}
          trend={{ value: 2, direction: 'down' }}
          color="purple"
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatsCard
          title="Pending RFQs"
          value={allSuppliersStats.pendingRFQs}
          icon={Clock}
          color="red"
        />
        <StatsCard
          title="Unread Messages"
          value={allSuppliersStats.unreadMessages}
          icon={MessageSquare}
          color="purple"
        />
        <StatsCard
          title="Documents Due"
          value={15}
          icon={FileText}
          color="yellow"
        />
      </div>

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <QuickActions />
        <RecentActivity />
        <TopSuppliers />
      </div>

      {/* Additional Info Panel for Selected Supplier */}
      {selectedSupplier && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {selectedSupplier.name} - Key Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{selectedSupplier.rating}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Rating</p>
            </div>
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{selectedSupplier.complianceScore}%</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Compliance</p>
            </div>
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-2xl font-bold text-purple-600">24</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Active RFQs</p>
            </div>
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-2xl font-bold text-orange-600">$2.4M</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">YTD Spend</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardTab;