import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, Activity } from 'lucide-react';

interface Module {
  name: string;
  status: 'completed' | 'in_progress' | 'pending';
  completedAt?: string;
  agent?: string;
}

interface HealthData {
  status: string;
  timestamp: string;
  checks: {
    database: {
      connected: boolean;
      timestamp?: string;
      error?: string;
    };
    endpoints: Array<{
      name: string;
      path: string;
      status: string;
      responseTime?: number;
    }>;
    codeQuality: {
      directDatabaseUsage: {
        totalFiles: number;
        violationsCount: number;
        violations: string[];
        status: string;
      };
    };
    migration: {
      modules: Module[];
      summary: {
        total: number;
        completed: number;
        inProgress: number;
        pending: number;
        percentComplete: number;
      };
    };
  };
  recommendations: string[];
}

const MigrationStatus: React.FC = () => {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: healthData, isLoading, error, refetch } = useQuery<HealthData>({
    queryKey: ['migration-health'],
    queryFn: async () => {
      const response = await axios.get('/api/health');
      return response.data;
    },
    refetchInterval: autoRefresh ? 30000 : false, // Refresh every 30 seconds
    retry: 3
  });

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        refetch();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refetch]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'available':
      case 'clean':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'in_progress':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'pending':
      case 'not_implemented':
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
      case 'error':
      case 'violations_found':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
        return 'bg-secondary text-foreground';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-secondary text-foreground';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Loading migration status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <XCircle className="w-8 h-8 mx-auto mb-4" />
          <p>Failed to load migration status</p>
          <button 
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!healthData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Database Migration Status</h1>
              <p className="text-muted-foreground mt-2">Real-time monitoring of the FF_React_Neon migration</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-muted-foreground">Auto-refresh</span>
              </label>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            Last updated: {new Date(healthData.timestamp).toLocaleString()}
          </div>
        </div>

        {/* Overall Status */}
        <div className="bg-card rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-2">Overall Health</h2>
              <div className="flex items-center gap-2">
                {healthData.status === 'healthy' ? (
                  <CheckCircle className="w-6 h-6 text-green-500" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-yellow-500" />
                )}
                <span className={`text-lg font-medium ${
                  healthData.status === 'healthy' ? 'text-green-600' : 'text-yellow-600'
                }`}>
                  {healthData.status.toUpperCase()}
                </span>
              </div>
            </div>
            <div className="text-right">
              <Activity className="w-12 h-12 text-blue-500" />
            </div>
          </div>
        </div>

        {/* Migration Progress */}
        <div className="bg-card rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Migration Progress</h2>
          
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-muted-foreground mb-2">
              <span>{healthData.checks.migration.summary.completed} of {healthData.checks.migration.summary.total} modules</span>
              <span>{healthData.checks.migration.summary.percentComplete}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-3">
              <div 
                className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${healthData.checks.migration.summary.percentComplete}%` }}
              />
            </div>
          </div>

          {/* Module Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {healthData.checks.migration.modules.map((module) => (
              <div key={module.name} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{module.name}</h3>
                  {getStatusIcon(module.status)}
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-sm px-2 py-1 rounded ${getStatusColor(module.status)}`}>
                    {module.status.replace('_', ' ')}
                  </span>
                  {module.agent && (
                    <span className="text-sm text-muted-foreground">{module.agent}</span>
                  )}
                </div>
                {module.completedAt && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Completed: {new Date(module.completedAt).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Database & API Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Database Status */}
          <div className="bg-card rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Database Connection</h2>
            <div className="flex items-center gap-3">
              {healthData.checks.database.connected ? (
                <>
                  <CheckCircle className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="font-medium text-green-600">Connected</p>
                    <p className="text-sm text-muted-foreground">
                      Last check: {new Date(healthData.checks.database.timestamp || '').toLocaleTimeString()}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="w-8 h-8 text-red-500" />
                  <div>
                    <p className="font-medium text-red-600">Disconnected</p>
                    <p className="text-sm text-red-500">{healthData.checks.database.error}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Code Quality */}
          <div className="bg-card rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Code Quality</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Direct DB Usage</span>
                <div className="flex items-center gap-2">
                  {healthData.checks.codeQuality.directDatabaseUsage.violationsCount === 0 ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <span className="text-green-600">Clean</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-5 h-5 text-red-500" />
                      <span className="text-red-600">
                        {healthData.checks.codeQuality.directDatabaseUsage.violationsCount} violations
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Scanned {healthData.checks.codeQuality.directDatabaseUsage.totalFiles} files
              </div>
            </div>
          </div>
        </div>

        {/* API Endpoints */}
        <div className="bg-card rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">API Endpoints</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {healthData.checks.endpoints.map((endpoint) => (
              <div key={endpoint.name} className="flex items-center justify-between p-3 border rounded">
                <span className="font-medium">{endpoint.name}</span>
                <div className="flex items-center gap-2">
                  {getStatusIcon(endpoint.status)}
                  <span className={`text-sm ${
                    endpoint.status === 'available' ? 'text-green-600' : 'text-muted-foreground'
                  }`}>
                    {endpoint.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendations */}
        {healthData.recommendations.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-3 text-yellow-800">Recommendations</h2>
            <ul className="space-y-2">
              {healthData.recommendations.map((rec, index) => (
                <li key={index} className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <span className="text-yellow-700">{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default MigrationStatus;