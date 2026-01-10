import { useState, useEffect } from 'react';
import type { GetServerSideProps } from 'next';
import { DashboardHeader } from '../../src/components/dashboard/DashboardHeader';
import { TaskCard } from '../../src/modules/field-app/components/TaskCard';
import { OfflineStatus } from '../../src/modules/field-app/components/OfflineStatus';
import { DeviceStatus } from '../../src/modules/field-app/components/DeviceStatus';
import { TaskDialog } from '../../src/modules/field-app/components/TaskDialog';
import { TechnicianCard } from '../../src/modules/field-app/components/TechnicianCard';
import type { FieldTask, FieldTechnician } from '../../src/modules/field-app/types/field-app.types';

interface FieldAppPageProps {
  initialTasks?: FieldTask[];
  initialTechnicians?: FieldTechnician[];
}

export default function FieldAppPage({ 
  initialTasks = [], 
  initialTechnicians = [] 
}: FieldAppPageProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [tasks, setTasks] = useState<FieldTask[]>(initialTasks);
  const [selectedTask, setSelectedTask] = useState<FieldTask | null>(null);
  const [technicians, setTechnicians] = useState<FieldTechnician[]>(initialTechnicians);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'technicians' | 'overview'>('tasks');
  const [isLoading, setIsLoading] = useState(!initialTasks.length);

  useEffect(() => {
    // Check if running on client side
    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      setupOfflineListeners();
    }
    
    // Load data if not provided from server
    if (!initialTasks.length) {
      loadFieldData();
    }
  }, []);

  const setupOfflineListeners = () => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineData();
    };
    
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  };

  const loadFieldData = async () => {
    setIsLoading(true);
    try {
      const [tasksResponse, techniciansResponse] = await Promise.all([
        fetch('/api/field/tasks'),
        fetch('/api/field/technicians')
      ]);
      
      if (!tasksResponse.ok || !techniciansResponse.ok) {
        throw new Error('Failed to load field data');
      }
      
      const tasksData = await tasksResponse.json();
      const techniciansData = await techniciansResponse.json();
      
      setTasks(tasksData.tasks || []);
      setTechnicians(techniciansData.technicians || []);
    } catch (error) {
      console.error('Error loading field data:', error);
      // Use mock data as fallback
      setTasks([]);
      setTechnicians([]);
    } finally {
      setIsLoading(false);
    }
  };

  const syncOfflineData = async () => {
    setSyncInProgress(true);
    try {
      const response = await fetch('/api/field/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tasks: tasks.filter(t => t.syncStatus === 'pending') 
        })
      });
      
      if (response.ok) {
        const syncedData = await response.json();
        setTasks(prevTasks => 
          prevTasks.map(task => ({
            ...task,
            syncStatus: 'synced',
            offline: false
          }))
        );
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setSyncInProgress(false);
    }
  };

  const handleTaskStatusUpdate = async (taskId: string, status: FieldTask['status']) => {
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === taskId 
          ? { ...task, status, syncStatus: 'pending', offline: !isOnline }
          : task
      )
    );
    
    if (isOnline) {
      try {
        await fetch(`/api/field/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
      } catch (error) {
        console.error('Failed to update task status:', error);
      }
    }
  };

  const handleTaskSelect = (task: FieldTask) => {
    setSelectedTask(task);
    setShowTaskDialog(true);
  };

  const handleTechnicianSelect = (_technician: FieldTechnician) => {
    // Handle technician selection
  };

  const handleRefresh = () => {
    loadFieldData();
    if (isOnline) {
      syncOfflineData();
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/field/export');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `field-report-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const getTodayStats = () => {
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    
    return { completed, inProgress, pending };
  };

  const stats = getTodayStats();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--ff-bg-tertiary)] flex items-center justify-center">
        <div className="text-[var(--ff-text-secondary)]">Loading field app data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
      <DashboardHeader 
        title="Field App Portal"
        onRefresh={handleRefresh}
        onExport={handleExport}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Status Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <OfflineStatus 
            isOffline={!isOnline}
            offlineData={{
              tasks: tasks.filter(t => t.syncStatus === 'pending').length,
              photos: 0,
              forms: 0,
              dataSize: '0 KB',
              lastSync: new Date().toLocaleTimeString()
            }}
            onSync={syncOfflineData}
            isSyncing={syncInProgress}
          />
          
          <DeviceStatus 
            battery={85}
            signal="good"
            gpsAccuracy={10}
            storage={{ used: 2.5, total: 8 }}
          />

          {/* Today's Stats */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Today's Progress</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[var(--ff-text-secondary)]">Completed</span>
                <span className="font-semibold text-green-600">{stats.completed}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--ff-text-secondary)]">In Progress</span>
                <span className="font-semibold text-blue-600">{stats.inProgress}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--ff-text-secondary)]">Pending</span>
                <span className="font-semibold text-[var(--ff-text-secondary)]">{stats.pending}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow mb-6">
          <div className="border-b border-[var(--ff-border-light)]">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('tasks')}
                className={`px-6 py-3 font-medium text-sm ${
                  activeTab === 'tasks'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                Tasks ({tasks.length})
              </button>
              <button
                onClick={() => setActiveTab('technicians')}
                className={`px-6 py-3 font-medium text-sm ${
                  activeTab === 'technicians'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                Technicians ({technicians.length})
              </button>
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-3 font-medium text-sm ${
                  activeTab === 'overview'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                Overview
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="space-y-4">
          {activeTab === 'tasks' && (
            <>
              {tasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onStatusUpdate={handleTaskStatusUpdate}
                  onClick={() => handleTaskSelect(task)}
                />
              ))}
              {tasks.length === 0 && (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-8 text-center text-[var(--ff-text-secondary)]">
                  No tasks assigned
                </div>
              )}
            </>
          )}

          {activeTab === 'technicians' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {technicians.map(technician => (
                <TechnicianCard
                  key={technician.id}
                  technician={technician}
                  onClick={() => handleTechnicianSelect(technician)}
                />
              ))}
              {technicians.length === 0 && (
                <div className="col-span-full bg-[var(--ff-bg-secondary)] rounded-lg shadow p-8 text-center text-[var(--ff-text-secondary)]">
                  No technicians available
                </div>
              )}
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4 text-[var(--ff-text-primary)]">Field Operations Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-[var(--ff-text-primary)] mb-2">Task Distribution</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Installation</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {tasks.filter(t => t.type === 'installation').length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Maintenance</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {tasks.filter(t => t.type === 'maintenance').length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Inspection</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {tasks.filter(t => t.type === 'inspection').length}
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-[var(--ff-text-primary)] mb-2">Technician Status</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">Available</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {technicians.filter(t => t.status === 'available').length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">On Task</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {technicians.filter(t => t.status === 'on_task').length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[var(--ff-text-secondary)]">On Break</span>
                      <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                        {technicians.filter(t => t.status === 'on_break').length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Task Dialog */}
      {showTaskDialog && selectedTask && (
        <TaskDialog
          task={selectedTask}
          onClose={() => {
            setShowTaskDialog(false);
            setSelectedTask(null);
          }}
          onStatusUpdate={handleTaskStatusUpdate}
        />
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  // Optionally fetch initial data on the server side
  // This improves SEO and initial load performance
  
  return {
    props: {
      initialTasks: [],
      initialTechnicians: []
    }
  };
};