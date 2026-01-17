/**
 * Asset Maintenance Page - Server Component
 * Shows maintenance schedule and records
 */

import Link from 'next/link';
import {
  Wrench,
  Plus,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';

interface MaintenanceRecord {
  id: string;
  assetId: string;
  assetName: string;
  assetNumber: string;
  maintenanceType: string;
  status: string;
  scheduledDate: string;
  completedDate?: string;
  providerName?: string;
  description?: string;
}

async function getUpcomingMaintenance(): Promise<MaintenanceRecord[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/maintenance/upcoming?limit=20`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching maintenance:', error);
    return [];
  }
}

async function getOverdueMaintenance(): Promise<MaintenanceRecord[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005'}/api/assets/maintenance/overdue?limit=20`,
      { cache: 'no-store' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching overdue:', error);
    return [];
  }
}

function getStatusBadge(status: string) {
  const defaultConfig = { color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300', label: 'Scheduled', Icon: Calendar };
  const configs: Record<string, { color: string; label: string; Icon: typeof Calendar }> = {
    scheduled: { color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300', label: 'Scheduled', Icon: Calendar },
    in_progress: { color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300', label: 'In Progress', Icon: Clock },
    completed: { color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300', label: 'Completed', Icon: CheckCircle },
    overdue: { color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300', label: 'Overdue', Icon: AlertTriangle },
  };

  const config = configs[status] ?? defaultConfig;
  const Icon = config.Icon;

  return (
    <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${config.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </span>
  );
}

export default async function MaintenancePage() {
  const [upcoming, overdue] = await Promise.all([
    getUpcomingMaintenance(),
    getOverdueMaintenance(),
  ]);

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Maintenance Schedule</h1>
          <p className="text-gray-600 dark:text-gray-400">Track and manage asset maintenance</p>
        </div>
        <Link
          href="/inventory/maintenance/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-5 w-5 mr-2" />
          Schedule Maintenance
        </Link>
      </div>

      {/* Overdue Alert */}
      {overdue.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
            <span className="font-medium text-red-800 dark:text-red-300">
              {overdue.length} maintenance {overdue.length === 1 ? 'task' : 'tasks'} overdue
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overdue */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-red-500" />
              Overdue
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{overdue.length} items</span>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {overdue.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <CheckCircle className="h-8 w-8 mx-auto text-green-400 mb-2" />
                No overdue maintenance
              </div>
            ) : (
              overdue.map((record) => (
                <Link
                  key={record.id}
                  href={`/inventory/${record.assetId}`}
                  className="block p-4 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{record.assetName}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{record.assetNumber}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 capitalize">
                        {record.maintenanceType.replace('_', ' ')}
                      </p>
                    </div>
                    <div className="text-right">
                      {getStatusBadge('overdue')}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Due: {new Date(record.scheduledDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Upcoming */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-blue-500" />
              Upcoming
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{upcoming.length} items</span>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {upcoming.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <Calendar className="h-8 w-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                No upcoming maintenance scheduled
              </div>
            ) : (
              upcoming.map((record) => (
                <Link
                  key={record.id}
                  href={`/inventory/${record.assetId}`}
                  className="block p-4 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{record.assetName}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{record.assetNumber}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 capitalize">
                        {record.maintenanceType.replace('_', ' ')}
                        {record.providerName && ` - ${record.providerName}`}
                      </p>
                    </div>
                    <div className="text-right">
                      {getStatusBadge(record.status)}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {new Date(record.scheduledDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{overdue.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Overdue</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-500" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{upcoming.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Scheduled</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-4">
          <div className="flex items-center">
            <div className="h-10 w-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
              <Wrench className="h-5 w-5 text-orange-500" />
            </div>
            <div className="ml-4">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{overdue.length + upcoming.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Tasks</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
