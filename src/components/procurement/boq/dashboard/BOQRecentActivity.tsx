/**
 * BOQ Recent Activity Component
 */

import { Activity, Upload, CheckCircle, Download, Users, Calendar } from 'lucide-react';

interface RecentActivity {
  id: string;
  type: 'upload' | 'mapping' | 'approval' | 'export';
  description: string;
  timestamp: Date;
  userId: string;
  boqId?: string;
}

interface BOQRecentActivityProps {
  recentActivity: RecentActivity[];
  formatRelativeTime: (date: Date) => string;
}

export default function BOQRecentActivity({
  recentActivity,
  formatRelativeTime
}: BOQRecentActivityProps) {
  const getActivityIcon = (type: RecentActivity['type']) => {
    switch (type) {
      case 'upload':
        return <Upload className="h-5 w-5 text-blue-500" />;
      case 'mapping':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'approval':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'export':
        return <Download className="h-5 w-5 text-purple-500" />;
      default:
        return <Activity className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="bg-card rounded-lg border">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-medium text-foreground">Recent Activity</h3>
      </div>
      <div className="divide-y divide-gray-200">
        {recentActivity.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            <Activity className="mx-auto h-8 w-8 text-gray-300 mb-2" />
            <p>No recent activity</p>
          </div>
        ) : (
          recentActivity.map((activity) => (
            <div key={activity.id} className="p-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{activity.description}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <Users className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-muted-foreground">{activity.userId}</span>
                    <Calendar className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(activity.timestamp)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}