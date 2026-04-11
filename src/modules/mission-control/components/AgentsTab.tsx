import { Wifi, WifiOff, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDisplayDate } from '@/utils/dateFormat';
import type { MCAgent } from '../types';

const AGENT_CONFIG: Record<string, { icon: string; color: string }> = {
  jarvis: { icon: '🧠', color: '#3b82f6' },
  velo: { icon: '⚙️', color: '#22c55e' },
  qfield: { icon: '📡', color: '#a855f7' },
};

function getAgentConfig(name: string) {
  return AGENT_CONFIG[name.toLowerCase()] || { icon: '🤖', color: '#6b7280' };
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDisplayDate(d);
}

interface AgentsTabProps {
  agents: MCAgent[];
}

export function AgentsTab({ agents }: AgentsTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      {agents.map((agent) => {
        const config = getAgentConfig(agent.agent);
        const isOnline = agent.status === 'online';
        const isBusy = agent.status === 'busy';
        const capabilities = agent.capabilities ? agent.capabilities.split(',').map(c => c.trim()) : [];

        return (
          <div
            key={agent.agent}
            className="rounded-lg border overflow-hidden"
            style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}
          >
            {/* Color bar */}
            <div className="h-1" style={{ background: config.color }} />

            <div className="p-5">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
                    style={{ background: `${config.color}22` }}
                  >
                    {config.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: config.color }}>{agent.agent}</h3>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--ff-bg-tertiary)', color: 'var(--ff-text-tertiary)' }}
                    >
                      {agent.type}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {isOnline || isBusy ? (
                    <Wifi className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-red-400" />
                  )}
                  <span className={cn(
                    'text-xs font-semibold px-2.5 py-1 rounded-full',
                    isOnline ? 'bg-emerald-500/20 text-emerald-400' :
                    isBusy ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-red-500/20 text-red-400'
                  )}>
                    {agent.status}
                  </span>
                </div>
              </div>

              {/* Role */}
              <p className="text-sm mb-4" style={{ color: 'var(--ff-text-secondary)' }}>
                {agent.role}
              </p>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg p-3" style={{ background: 'var(--ff-bg-tertiary)' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <Clock className="w-3 h-3" style={{ color: 'var(--ff-text-tertiary)' }} />
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ff-text-tertiary)' }}>Last Active</span>
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'var(--ff-text-primary)' }}>
                    {formatTime(agent.last_active)}
                  </span>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'var(--ff-bg-tertiary)' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <Zap className="w-3 h-3" style={{ color: 'var(--ff-text-tertiary)' }} />
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ff-text-tertiary)' }}>Heartbeat</span>
                  </div>
                  <span className="text-sm font-medium" style={{ color: 'var(--ff-text-primary)' }}>
                    {formatTime(agent.last_heartbeat)}
                  </span>
                </div>
              </div>

              {/* Current Task */}
              {agent.current_task && (
                <div className="rounded-lg p-3 mb-4" style={{ background: 'var(--ff-bg-primary)', border: '1px dashed var(--ff-border-light)' }}>
                  <span className="text-[10px] uppercase tracking-wide font-medium" style={{ color: 'var(--ff-text-tertiary)' }}>Current Task</span>
                  <p className="text-sm mt-1" style={{ color: 'var(--ff-text-primary)' }}>{agent.current_task}</p>
                </div>
              )}

              {/* Capabilities */}
              {capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.map(cap => (
                    <span
                      key={cap}
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: `${config.color}15`, color: config.color, border: `1px solid ${config.color}30` }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {agents.length === 0 && (
        <div className="col-span-full text-center py-12" style={{ color: 'var(--ff-text-tertiary)' }}>
          No agents registered
        </div>
      )}
    </div>
  );
}
