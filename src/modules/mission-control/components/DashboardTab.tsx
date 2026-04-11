import React from 'react';
import { Users, MessageSquare, ListTodo, Wifi, WifiOff, Clock, Loader } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { MCDashboard } from '../types';
import { SystemHealthPanel } from './SystemHealthPanel';

interface DashboardTabProps {
  data: MCDashboard | null;
}

const AGENT_CONFIG: Record<string, { icon: string; color: string }> = {
  jarvis: { icon: '🧠', color: '#3b82f6' },
  velo: { icon: '⚙️', color: '#22c55e' },
  qfield: { icon: '📡', color: '#a855f7' },
};

function getAgentConfig(name: string) {
  const key = name.toLowerCase();
  return AGENT_CONFIG[key] || { icon: '🤖', color: '#6b7280' };
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-lg p-4 border" style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--ff-text-tertiary)' }}>{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color: 'var(--ff-text-primary)' }}>{value}</p>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DashboardTab({ data }: DashboardTabProps) {
  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="md" label="" />
      </div>
    );
  }

  const { stats, agents, system, services } = data;

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Online Agents" value={stats.onlineAgents} icon={Users} color="#22c55e" />
        <StatCard label="Messages Today" value={stats.todayMessages} icon={MessageSquare} color="#3b82f6" />
        <StatCard label="Pending Tasks" value={stats.pendingTasks} icon={ListTodo} color="#f59e0b" />
        <StatCard label="In Progress" value={stats.inProgressTasks} icon={Loader} color="#a855f7" />
      </div>

      {/* Agent Status Cards */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--ff-text-primary)' }}>Agent Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const config = getAgentConfig(agent.agent);
            const isOnline = agent.status === 'online';
            const isBusy = agent.status === 'busy';
            return (
              <div
                key={agent.agent}
                className="rounded-lg p-4 border"
                style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{config.icon}</span>
                    <div>
                      <h4 className="font-semibold capitalize" style={{ color: config.color }}>{agent.agent}</h4>
                      <p className="text-xs" style={{ color: 'var(--ff-text-tertiary)' }}>{agent.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isOnline || isBusy ? (
                      <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      isOnline ? 'bg-emerald-500/20 text-emerald-400' :
                      isBusy ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    )}>
                      {agent.status}
                    </span>
                  </div>
                </div>
                {agent.current_task && (
                  <p className="text-xs mb-2 truncate" style={{ color: 'var(--ff-text-secondary)' }}>
                    <span className="font-medium">Task:</span> {agent.current_task}
                  </p>
                )}
                <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--ff-text-tertiary)' }}>
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(agent.last_active)}
                </div>
                {agent.capabilities && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {agent.capabilities.split(',').slice(0, 4).map((cap) => (
                      <span
                        key={cap}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--ff-bg-tertiary)', color: 'var(--ff-text-tertiary)' }}
                      >
                        {cap.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* System Health & Services */}
      <SystemHealthPanel health={system} services={services} />
    </div>
  );
}
