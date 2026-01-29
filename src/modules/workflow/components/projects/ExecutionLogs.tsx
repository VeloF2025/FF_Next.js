// 🟢 WORKING: ExecutionLogs component - displays workflow execution audit trail
import { useState, useEffect } from 'react';
import {
  Clock,
  User,
  Activity,
  AlertCircle,
  CheckCircle2,
  Play,
  Pause,
  FileText,
  Search,
  Download,
  RefreshCw
} from 'lucide-react';

import type { WorkflowExecutionLog, ProjectWorkflow } from '../../types/workflow.types';
import { formatDate } from '../../../../utils/dateHelpers';
import { log } from '@/lib/logger';

interface ExecutionLogsProps {
  workflowId?: string;
  workflow?: ProjectWorkflow;
  compact?: boolean;
  maxHeight?: string;
}

export function ExecutionLogs({ 
  workflowId, 
  workflow, 
  compact = false, 
  maxHeight = 'h-96' 
}: ExecutionLogsProps) {
  const [logs, setLogs] = useState<WorkflowExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');

  useEffect(() => {
    loadLogs();
  }, [workflowId]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      // TODO: Replace with real API call when workflow_execution_logs table exists
      // For now, return empty array - no fake data in production
      log.debug('ExecutionLogs', { action: 'loadLogs', workflowId });
      setLogs([]);
    } catch (error) {
      log.error('ExecutionLogs', { action: 'loadLogs', error });
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'started':
        return <Play className="w-4 h-4 text-green-600" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-600" />;
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'updated':
        return <Activity className="w-4 h-4 text-purple-600" />;
      case 'assigned':
        return <User className="w-4 h-4 text-indigo-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'started':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'completed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'updated':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400';
      case 'assigned':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = searchTerm === '' || 
      log.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.actorName?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesActor = actorFilter === 'all' || log.actorId === actorFilter;
    
    return matchesSearch && matchesAction && matchesActor;
  });

  // Get unique actors for filter
  const uniqueActors = Array.from(new Set(logs.map(log => log.actorId)))
    .map(actorId => {
      const log = logs.find(l => l.actorId === actorId);
      return { id: actorId, name: log?.actorName || 'Unknown' };
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="flex items-center space-x-2">
          <RefreshCw className="w-4 h-4 animate-spin text-green-600" />
          <span className="text-gray-600 dark:text-gray-400">Loading logs...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3">
          <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Execution Log
          </h3>
          <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-1 rounded-full">
            {filteredLogs.length} entries
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={loadLogs}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Export Logs"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex-1 min-w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>
          </div>
          
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="all">All Actions</option>
            <option value="started">Started</option>
            <option value="completed">Completed</option>
            <option value="updated">Updated</option>
            <option value="paused">Paused</option>
            <option value="assigned">Assigned</option>
          </select>
          
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="all">All Users</option>
            {uniqueActors.map(actor => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Log Entries */}
      <div className={`overflow-y-auto ${maxHeight}`}>
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <FileText className="w-12 h-12 text-gray-400 mb-3" />
            <p className="text-gray-600 dark:text-gray-400 text-center">
              {searchTerm || actionFilter !== 'all' || actorFilter !== 'all' 
                ? 'No logs match your filters' 
                : 'No execution logs available'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start space-x-3">
                  {/* Action Icon */}
                  <div className="flex-shrink-0 mt-1">
                    {getActionIcon(log.action)}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                        {log.action.charAt(0).toUpperCase() + log.action.slice(1)}
                      </span>
                      
                      {log.duration && log.duration > 0 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDuration(log.duration)}
                        </span>
                      )}
                      
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(log.timestamp)}
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-2 mb-2">
                      <User className="w-3 h-3 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {log.actorName || 'Unknown User'}
                      </span>
                      
                      {log.previousStatus && log.newStatus && (
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {log.previousStatus} → {log.newStatus}
                        </span>
                      )}
                    </div>
                    
                    {log.notes && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                        {log.notes}
                      </p>
                    )}
                    
                    {/* Attachments */}
                    {log.attachments && log.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {log.attachments.map((attachment, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center space-x-1 text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400 px-2 py-1 rounded"
                          >
                            <FileText className="w-3 h-3" />
                            <span>{attachment}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {/* Metadata */}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {Object.entries(log.metadata).map(([key, value]) => (
                          <span key={key} className="mr-3">
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Timestamp */}
                  <div className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}