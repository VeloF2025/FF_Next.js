'use client';

import React, { useState } from 'react';
import { RefreshCw, Satellite, Activity, MessageSquare, Users, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMissionControl } from './hooks/useMissionControl';
import { DashboardTab } from './components/DashboardTab';
import { LiveFeedTab } from './components/LiveFeedTab';
import { AgentsTab } from './components/AgentsTab';
import { TaskBoardTab } from './components/TaskBoardTab';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'live-feed', label: 'Live Feed', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'tasks', label: 'Task Board', icon: ListTodo },
] as const;

type TabId = typeof TABS[number]['id'];

const MissionControlDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const {
    data,
    messages,
    isLoading,
    error,
    refetch,
    createTask,
    updateTask,
    deleteTask,
  } = useMissionControl({ activeTab });

  const onlineCount = data?.stats.onlineAgents ?? 0;
  const totalAgents = data?.stats.totalAgents ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--ff-primary)', opacity: 0.9 }}
          >
            <Satellite className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--ff-text-primary)' }}>
              Mission Control
            </h1>
            <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>
              {onlineCount}/{totalAgents} agents online
              {data?.timestamp && (
                <span style={{ color: 'var(--ff-text-tertiary)' }}>
                  {' · '}Updated {new Date(data.timestamp).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-50"
          style={{ borderColor: 'var(--ff-border-light)', color: 'var(--ff-text-secondary)' }}
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg p-3 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          ⚠️ Connection issue: {error}. Data may be stale.
        </div>
      )}

      {/* Tabs */}
      <div className="border rounded-lg" style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}>
        <div className="border-b" style={{ borderColor: 'var(--ff-border-light)' }}>
          <nav className="flex gap-1 px-4 -mb-px">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 py-3 px-4 border-b-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                      : 'border-transparent text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.id === 'tasks' && data && data.stats.pendingTasks > 0 && (
                    <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                      {data.stats.pendingTasks}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'dashboard' && <DashboardTab data={data} />}
          {activeTab === 'live-feed' && <LiveFeedTab messages={messages} />}
          {activeTab === 'agents' && <AgentsTab agents={data?.agents || []} />}
          {activeTab === 'tasks' && (
            <TaskBoardTab
              tasks={data?.tasks || []}
              agents={data?.agents || []}
              onCreateTask={createTask}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default MissionControlDashboard;
