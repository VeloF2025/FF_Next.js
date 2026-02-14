/**
 * BOQ Overview Component
 * Displays dashboard overview with statistics, recent activity, and quick actions
 */

import { FileText, Upload, List, TrendingUp, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { BOQ, BOQStats, BOQStatusType } from '@/types/procurement/boq.types';
import { ImportJob, ImportStats } from '@/services/procurement/boqImportService';
import { RecentActivity } from './BOQDashboardTypes';

interface BOQOverviewProps {
  stats: BOQStats | null;
  importStats: ImportStats | null;
  recentBOQs: BOQ[];
  recentActivity: RecentActivity[];
  activeJobs: ImportJob[];
  isLoading: boolean;
  onUpload: () => void;
  onViewList: () => void;
  onViewAnalytics: () => void;
  onExport: () => void;
  onSelectBOQ: (boq: BOQ) => void;
  formatRelativeTime: (date: Date) => string;
  getStatusColor: (status: BOQStatusType) => string;
}

export default function BOQOverview({
  stats,
  // importStats, // TODO: Implement import stats display
  recentBOQs,
  recentActivity,
  activeJobs,
  isLoading,
  onUpload,
  onViewList,
  onViewAnalytics,
  onExport,
  onSelectBOQ,
  formatRelativeTime,
  getStatusColor
}: BOQOverviewProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">Loading overview...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button
          onClick={onUpload}
          className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-blue-400"
        >
          <Upload className="h-8 w-8 text-blue-600 mx-auto mb-2" />
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Upload BOQ</span>
        </button>
        
        <button
          onClick={onViewList}
          className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <List className="h-8 w-8 text-green-600 mx-auto mb-2" />
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">View BOQs</span>
        </button>
        
        <button
          onClick={onViewAnalytics}
          className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <TrendingUp className="h-8 w-8 text-purple-600 mx-auto mb-2" />
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Analytics</span>
        </button>
        
        <button
          onClick={onExport}
          className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <FileText className="h-8 w-8 text-orange-600 mx-auto mb-2" />
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Export Report</span>
        </button>
      </div>

      {/* Statistics Overview */}
      {stats && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">BOQ Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total BOQs</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.totalBOQs}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Active</p>
              <p className="text-2xl font-bold text-green-600">{stats.activeBOQs}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Pending</p>
              <p className="text-2xl font-bold text-yellow-600">{stats.pendingApproval}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Exceptions</p>
              <p className="text-2xl font-bold text-red-600">{stats.exceptionsCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* Active Import Jobs */}
      {activeJobs.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
            <h3 className="text-sm font-semibold text-yellow-800">Active Import Jobs</h3>
          </div>
          <div className="mt-2 space-y-2">
            {activeJobs.map(job => (
              <div key={job.id} className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">{job.fileName}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {job.progress}% - {job.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent BOQs */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent BOQs</h3>
          <div className="space-y-3">
            {recentBOQs.length > 0 ? (
              recentBOQs.map(boq => (
                <button
                  key={boq.id}
                  onClick={() => onSelectBOQ(boq)}
                  className="w-full text-left p-3 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{boq.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {boq.itemCount} items • ${boq.totalValue?.toLocaleString()}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(boq.status)}`}>
                      {boq.status}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">No recent BOQs</p>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {recentActivity.length > 0 ? (
              recentActivity.map(activity => (
                <div key={activity.id} className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    {activity.type === 'upload' && <Upload className="h-4 w-4 text-blue-600 mt-1" />}
                    {activity.type === 'mapping' && <FileText className="h-4 w-4 text-yellow-600 mt-1" />}
                    {activity.type === 'approval' && <FileText className="h-4 w-4 text-green-600 mt-1" />}
                    {activity.type === 'update' && <Clock className="h-4 w-4 text-gray-600 dark:text-gray-400 mt-1" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-900 dark:text-gray-100">{activity.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {activity.userId} • {formatRelativeTime(activity.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">No recent activity</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}