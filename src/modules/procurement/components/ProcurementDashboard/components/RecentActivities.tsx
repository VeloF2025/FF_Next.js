/**
 * Recent Activities Component
 * Displays recent procurement activities with status indicators
 */

import { Link } from 'react-router-dom';
import { RecentActivity } from '../types/dashboard.types';
import { getStatusIcon } from '../utils/dashboardUtils';

interface RecentActivitiesProps {
  activities: RecentActivity[];
}

export function RecentActivities({ activities }: RecentActivitiesProps) {
  return (
    <div className="bg-card shadow rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-lg font-medium text-foreground">Recent Activities</h3>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                {getStatusIcon(activity.status)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{activity.type}</span> {activity.action}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{activity.item}</p>
                <p className="text-xs text-muted-foreground mt-1">{activity.timestamp}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Link
            to="/app/procurement/reports"
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View all activities →
          </Link>
        </div>
      </div>
    </div>
  );
}