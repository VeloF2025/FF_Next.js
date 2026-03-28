import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, MessageSquare, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { log } from '@/lib/logger';
import { nudgeAgent } from '@/lib/mc-nudge';
import type { MCMessage } from '../types';

interface LiveFeedTabProps {
  messages: MCMessage[];
}

const AGENT_COLORS: Record<string, string> = {
  jarvis: '#3b82f6',
  velo: '#22c55e',
  qfield: '#a855f7',
};

const AGENT_ICONS: Record<string, string> = {
  jarvis: '🧠',
  velo: '⚙️',
  qfield: '📡',
};

function getAgentColor(name: string): string {
  return AGENT_COLORS[name.toLowerCase()] || '#6b7280';
}

function getAgentIcon(name: string): string {
  return AGENT_ICONS[name.toLowerCase()] || '🤖';
}

const TYPE_BADGES: Record<string, { bg: string; text: string }> = {
  heartbeat: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  command: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  response: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400' },
  info: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  task: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
};

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function LiveFeedTab({ messages }: LiveFeedTabProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [nudgingId, setNudgingId] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleNudge = async (msg: MCMessage) => {
    if (!msg.to_agent) return;
    
    setNudgingId(msg.id);
    try {
      await nudgeAgent({
        toAgent: msg.to_agent,
        subject: msg.message.substring(0, 80),
      });
    } catch (error) {
      log.warn('nudge-failed', { toAgent: msg.to_agent, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setNudgingId(null);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-280px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4" style={{ color: 'var(--ff-primary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--ff-text-primary)' }}>
            Live Feed
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
            ● Polling 3s
          </span>
        </div>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={cn(
            'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
            autoScroll ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400'
          )}
          style={{ background: autoScroll ? undefined : 'var(--ff-bg-tertiary)' }}
        >
          {autoScroll ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
          Auto-scroll {autoScroll ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto rounded-lg border p-3 space-y-2"
        style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm" style={{ color: 'var(--ff-text-tertiary)' }}>No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => {
            const badge = TYPE_BADGES[msg.type] ?? TYPE_BADGES['info']!;
            const isNudging = nudgingId === msg.id;
            return (
              <div
                key={msg.id}
                className="flex items-start gap-3 p-2 rounded hover:bg-card/5 transition-colors group"
              >
                <span className="text-lg mt-0.5">{getAgentIcon(msg.from_agent)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold capitalize" style={{ color: getAgentColor(msg.from_agent) }}>
                      {msg.from_agent}
                    </span>
                    {msg.to_agent && (
                      <>
                        <span className="text-xs" style={{ color: 'var(--ff-text-tertiary)' }}>→</span>
                        <span className="text-xs capitalize" style={{ color: getAgentColor(msg.to_agent) }}>
                          {msg.to_agent}
                        </span>
                      </>
                    )}
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', badge.bg, badge.text)}>
                      {msg.type}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--ff-text-tertiary)' }}>
                      {formatTime(msg.ts)}
                    </span>
                    {msg.to_agent && (
                      <button
                        onClick={() => handleNudge(msg)}
                        disabled={isNudging}
                        title="Nudge agent"
                        className={cn(
                          'ml-auto p-1 rounded transition-all opacity-0 group-hover:opacity-100',
                          isNudging
                            ? 'opacity-100 cursor-wait'
                            : 'hover:bg-yellow-500/20 hover:text-yellow-400'
                        )}
                        style={{
                          color: isNudging ? 'var(--ff-text-tertiary)' : 'var(--ff-text-tertiary)',
                        }}
                      >
                        <Bell
                          className={cn(
                            'w-4 h-4',
                            isNudging && 'animate-pulse'
                          )}
                        />
                      </button>
                    )}
                  </div>
                  <p className="text-sm" style={{ color: 'var(--ff-text-secondary)' }}>{msg.message}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
