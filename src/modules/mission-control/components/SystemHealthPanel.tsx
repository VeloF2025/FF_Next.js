import React from 'react';
import { Activity, HardDrive, Cpu, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MCSystemHealth, MCService } from '../types';

interface SystemHealthPanelProps {
  health: MCSystemHealth | null;
  services: MCService[];
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function ProgressBar({ label, percent, icon: Icon }: { label: string; percent: number; icon: React.ElementType }) {
  const color = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5" style={{ color: 'var(--ff-text-secondary)' }}>
          <Icon className="w-3.5 h-3.5" />
          {label}
        </span>
        <span style={{ color: 'var(--ff-text-primary)' }} className="font-medium">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: 'var(--ff-bg-primary)' }}>
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

export function SystemHealthPanel({ health, services }: SystemHealthPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* System Health */}
      <div className="rounded-lg p-4 border" style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text-primary)' }}>
          <Activity className="w-4 h-4" style={{ color: 'var(--ff-primary)' }} />
          System Health
        </h3>
        {health ? (
          <div className="space-y-3">
            <ProgressBar label="Memory" percent={health.memory.percent} icon={Cpu} />
            <ProgressBar label="Disk" percent={health.disk.percent} icon={HardDrive} />
            <div className="flex items-center justify-between text-sm pt-1">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--ff-text-secondary)' }}>
                <Cpu className="w-3.5 h-3.5" />
                Load Avg
              </span>
              <span style={{ color: 'var(--ff-text-primary)' }} className="font-medium">
                {health.loadAvg.map(l => l.toFixed(2)).join(' / ')}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--ff-text-secondary)' }}>
                <Clock className="w-3.5 h-3.5" />
                Uptime
              </span>
              <span style={{ color: 'var(--ff-text-primary)' }} className="font-medium">
                {formatUptime(health.uptimeSeconds)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--ff-text-tertiary)' }}>Loading...</p>
        )}
      </div>

      {/* Services */}
      <div className="rounded-lg p-4 border" style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text-primary)' }}>
          <HardDrive className="w-4 h-4" style={{ color: 'var(--ff-primary)' }} />
          Services
        </h3>
        <div className="space-y-2.5">
          {services.map((svc) => {
            const isRunning = svc.status === 'running' || svc.portOpen === true;
            return (
              <div key={svc.name} className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--ff-text-secondary)' }}>{svc.label}</span>
                <div className="flex items-center gap-2">
                  <div className={cn('w-2 h-2 rounded-full', isRunning ? 'bg-emerald-500' : 'bg-red-500')} />
                  <span className={cn('text-xs font-medium', isRunning ? 'text-emerald-400' : 'text-red-400')}>
                    {isRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>
              </div>
            );
          })}
          {services.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--ff-text-tertiary)' }}>No services data</p>
          )}
        </div>
      </div>
    </div>
  );
}
