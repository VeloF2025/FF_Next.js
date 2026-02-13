import React, { useState } from 'react';
import { Plus, X, ChevronRight, ChevronLeft, Check, RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MCTask, MCAgent } from '../types';

const AGENT_COLORS: Record<string, string> = {
  jarvis: '#3b82f6', velo: '#22c55e', qfield: '#a855f7',
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'bg-red-500/20', text: 'text-red-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  normal: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  low: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

interface TaskBoardTabProps {
  tasks: MCTask[];
  agents: MCAgent[];
  onCreateTask: (task: { title: string; description?: string; assigned_to?: string; priority?: string }) => Promise<any>;
  onUpdateTask: (id: number, updates: Partial<MCTask>) => Promise<any>;
  onDeleteTask: (id: number) => Promise<boolean>;
}

function TaskCard({ task, onMove, onDelete }: {
  task: MCTask;
  onMove: (id: number, status: string) => void;
  onDelete: (id: number) => void;
}) {
  const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.normal;
  const agentColor = task.assigned_to ? AGENT_COLORS[task.assigned_to.toLowerCase()] || '#6b7280' : '#6b7280';

  return (
    <div
      className="rounded-lg p-3 border mb-2 group transition-all hover:border-[var(--ff-primary)]"
      style={{ background: 'var(--ff-bg-tertiary)', borderColor: 'var(--ff-border-light)' }}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-medium flex-1" style={{ color: 'var(--ff-text-primary)' }}>{task.title}</h4>
        <button
          onClick={() => onDelete(task.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20"
        >
          <Trash2 className="w-3 h-3 text-red-400" />
        </button>
      </div>
      {task.description && (
        <p className="text-xs mb-2 line-clamp-2" style={{ color: 'var(--ff-text-tertiary)' }}>{task.description}</p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {task.assigned_to && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${agentColor}20`, color: agentColor }}>
              {task.assigned_to}
            </span>
          )}
          <span className={cn('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded', priorityStyle.bg, priorityStyle.text)}>
            {task.priority}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {task.status !== 'pending' && (
            <button
              onClick={() => onMove(task.id, task.status === 'completed' ? 'pending' : 'pending')}
              className="p-1 rounded hover:bg-[var(--ff-bg-secondary)]" title="Move back"
            >
              {task.status === 'completed' ? <RotateCcw className="w-3 h-3" style={{ color: 'var(--ff-text-tertiary)' }} /> : <ChevronLeft className="w-3 h-3" style={{ color: 'var(--ff-text-tertiary)' }} />}
            </button>
          )}
          {task.status !== 'completed' && (
            <button
              onClick={() => onMove(task.id, task.status === 'pending' ? 'in-progress' : 'completed')}
              className="p-1 rounded hover:bg-[var(--ff-bg-secondary)]" title="Move forward"
            >
              {task.status === 'in-progress' ? <Check className="w-3 h-3 text-emerald-400" /> : <ChevronRight className="w-3 h-3" style={{ color: 'var(--ff-text-tertiary)' }} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TaskBoardTab({ tasks, agents, onCreateTask, onUpdateTask, onDeleteTask }: TaskBoardTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAssign, setNewAssign] = useState('');
  const [newPriority, setNewPriority] = useState('normal');

  const columns: { key: string; label: string; icon: string; color: string }[] = [
    { key: 'pending', label: 'Pending', icon: '📥', color: '#f59e0b' },
    { key: 'in-progress', label: 'In Progress', icon: '🔄', color: '#3b82f6' },
    { key: 'completed', label: 'Completed', icon: '✅', color: '#22c55e' },
  ];

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    await onCreateTask({
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      assigned_to: newAssign || undefined,
      priority: newPriority,
    });
    setNewTitle('');
    setNewDesc('');
    setNewAssign('');
    setNewPriority('normal');
    setShowModal(false);
  };

  const handleMove = (id: number, status: string) => onUpdateTask(id, { status: status as MCTask['status'] });
  const handleDelete = (id: number) => { if (confirm('Delete this task?')) onDeleteTask(id); };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ff-text-primary)' }}>Agent Task Board</h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
          style={{ background: 'var(--ff-primary)', color: '#fff' }}
        >
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ minHeight: 'calc(100vh - 320px)' }}>
        {columns.map(col => {
          const colTasks = tasks.filter(t => t.status === col.key);
          return (
            <div key={col.key} className="flex flex-col">
              <div
                className="rounded-t-lg px-4 py-2.5 flex items-center justify-between"
                style={{ background: 'var(--ff-bg-tertiary)', borderBottom: `2px solid ${col.color}` }}
              >
                <span className="text-sm font-semibold" style={{ color: 'var(--ff-text-primary)' }}>
                  {col.icon} {col.label}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${col.color}20`, color: col.color }}>
                  {colTasks.length}
                </span>
              </div>
              <div
                className="flex-1 rounded-b-lg p-2 overflow-y-auto border border-t-0"
                style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}
              >
                {colTasks.map(task => (
                  <TaskCard key={task.id} task={task} onMove={handleMove} onDelete={handleDelete} />
                ))}
                {colTasks.length === 0 && (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--ff-text-tertiary)' }}>No tasks</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Task Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div
            className="rounded-xl p-6 w-full max-w-md border"
            style={{ background: 'var(--ff-bg-secondary)', borderColor: 'var(--ff-border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--ff-text-primary)' }}>New Task</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)]">
                <X className="w-5 h-5" style={{ color: 'var(--ff-text-tertiary)' }} />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Task title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:border-[var(--ff-primary)]"
                style={{ background: 'var(--ff-bg-tertiary)', borderColor: 'var(--ff-border-light)', color: 'var(--ff-text-primary)' }}
                autoFocus
              />
              <textarea
                placeholder="Description (optional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:border-[var(--ff-primary)] resize-none"
                style={{ background: 'var(--ff-bg-tertiary)', borderColor: 'var(--ff-border-light)', color: 'var(--ff-text-primary)' }}
              />
              <select
                value={newAssign}
                onChange={e => setNewAssign(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ background: 'var(--ff-bg-tertiary)', borderColor: 'var(--ff-border-light)', color: 'var(--ff-text-primary)' }}
              >
                <option value="">Unassigned</option>
                {agents.map(a => <option key={a.agent} value={a.agent}>{a.agent}</option>)}
              </select>
              <select
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ background: 'var(--ff-bg-tertiary)', borderColor: 'var(--ff-border-light)', color: 'var(--ff-text-primary)' }}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--ff-border-light)', color: 'var(--ff-text-secondary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                style={{ background: 'var(--ff-primary)' }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
