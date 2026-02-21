/**
 * Approval Workflows Section
 *
 * Visual management of approval workflows:
 * - Toggle workflows on/off
 * - Edit approval levels (thresholds, approvers)
 * - Assign specific users or roles as approvers
 * - Visual flow diagram of approval levels
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  User,
  Users,
  AlertCircle,
  Save,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ArrowRight,
  CheckCircle,
  Loader2,
} from 'lucide-react';

interface ApprovalLevel {
  id: string | null;
  levelNumber: number;
  name: string;
  minAmount: number;
  maxAmount: number | null;
  approverType: 'user' | 'role';
  approverUserId: string | null;
  approverRole: string | null;
  approverName: string | null;
  autoApprove: boolean;
}

interface Workflow {
  id: string;
  workflowType: string;
  name: string;
  description: string;
  isActive: boolean;
  escalationEnabled: boolean;
  escalationHours: number;
  levels: ApprovalLevel[];
}

interface AvailableUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ApprovalStats {
  documentType: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export function ApprovalWorkflowsSection() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [stats, setStats] = useState<ApprovalStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<string | null>(null);
  const [deletedLevelIds, setDeletedLevelIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/settings/procurement/workflows');
      const json = await res.json();
      if (json.success) {
        setWorkflows(json.data.workflows);
        setAvailableUsers(json.data.availableUsers);
        setStats(json.data.stats);
      } else {
        setError(json.error?.message || 'Failed to load');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleActive = async (workflow: Workflow) => {
    setIsSaving(workflow.id);
    try {
      const res = await fetch('/api/settings/procurement/workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflow.id,
          updates: { isActive: !workflow.isActive },
        }),
      });
      const json = await res.json();
      if (json.success) {
        setWorkflows(prev =>
          prev.map(w => w.id === workflow.id ? { ...w, isActive: !w.isActive } : w)
        );
      }
    } catch {
      setError('Failed to update workflow');
    } finally {
      setIsSaving(null);
    }
  };

  const handleSaveLevels = async (workflow: Workflow) => {
    setIsSaving(workflow.id);
    try {
      const res = await fetch('/api/settings/procurement/workflows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflow.id,
          updates: {
            levels: workflow.levels,
            deletedLevelIds,
            escalationEnabled: workflow.escalationEnabled,
            escalationHours: workflow.escalationHours,
          },
        }),
      });
      const json = await res.json();
      if (json.success) {
        setEditingWorkflow(null);
        setDeletedLevelIds([]);
        await fetchData();
      }
    } catch {
      setError('Failed to save levels');
    } finally {
      setIsSaving(null);
    }
  };

  const updateLevel = (workflowId: string, levelIndex: number, updates: Partial<ApprovalLevel>) => {
    setWorkflows(prev =>
      prev.map(w => {
        if (w.id !== workflowId) return w;
        const newLevels = [...w.levels];
        newLevels[levelIndex] = { ...newLevels[levelIndex]!, ...updates };
        return { ...w, levels: newLevels };
      })
    );
  };

  const addLevel = (workflowId: string) => {
    setWorkflows(prev =>
      prev.map(w => {
        if (w.id !== workflowId) return w;
        const lastLevel = w.levels[w.levels.length - 1];
        const newLevel: ApprovalLevel = {
          id: null,
          levelNumber: (lastLevel?.levelNumber || 0) + 1,
          name: 'New Level',
          minAmount: lastLevel?.maxAmount || 0,
          maxAmount: null,
          approverType: 'role',
          approverUserId: null,
          approverRole: 'manager',
          approverName: null,
          autoApprove: false,
        };
        return { ...w, levels: [...w.levels, newLevel] };
      })
    );
  };

  const removeLevel = (workflowId: string, levelIndex: number) => {
    setWorkflows(prev =>
      prev.map(w => {
        if (w.id !== workflowId) return w;
        const removed = w.levels[levelIndex];
        if (removed?.id) {
          setDeletedLevelIds(prev => [...prev, removed.id!]);
        }
        return { ...w, levels: w.levels.filter((_, i) => i !== levelIndex) };
      })
    );
  };

  const formatAmount = (amount: number) =>
    `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--ff-text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading workflows...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 text-red-400">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Stats Cards */}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {stats.map(s => (
            <div
              key={s.documentType}
              className="p-4 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]"
            >
              <div className="text-sm font-medium text-[var(--ff-text-primary)] capitalize">
                {s.documentType.replace(/_/g, ' ')}
              </div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)] mt-1">
                {s.total}
              </div>
              <div className="flex gap-3 text-sm mt-1.5">
                <span className="text-yellow-400 font-medium">{s.pending} pending</span>
                <span className="text-green-400 font-medium">{s.approved} approved</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Workflow Cards */}
      {workflows.map(workflow => {
        const isEditing = editingWorkflow === workflow.id;
        const isBusy = isSaving === workflow.id;

        return (
          <div
            key={workflow.id}
            className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]"
          >
            {/* Workflow Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-[var(--ff-primary-400)]" />
                <div>
                  <h5 className="text-base font-semibold text-[var(--ff-text-primary)]">{workflow.name}</h5>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{workflow.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleActive(workflow)}
                  disabled={isBusy}
                  className="flex items-center gap-1 text-sm"
                  title={workflow.isActive ? 'Disable workflow' : 'Enable workflow'}
                >
                  {workflow.isActive ? (
                    <ToggleRight className="w-6 h-6 text-green-400" />
                  ) : (
                    <ToggleLeft className="w-6 h-6 text-[var(--ff-text-tertiary)]" />
                  )}
                  <span className={`text-xs ${workflow.isActive ? 'text-green-400' : 'text-[var(--ff-text-tertiary)]'}`}>
                    {workflow.isActive ? 'Active' : 'Disabled'}
                  </span>
                </button>
                {!isEditing ? (
                  <button
                    onClick={() => setEditingWorkflow(workflow.id)}
                    className="px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--ff-primary-500)]/20 text-[var(--ff-primary-300)] hover:bg-[var(--ff-primary-500)]/30 transition-colors"
                  >
                    Edit Levels
                  </button>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditingWorkflow(null);
                        setDeletedLevelIds([]);
                        fetchData();
                      }}
                      className="px-3 py-1 text-xs rounded-md text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveLevels(workflow)}
                      disabled={isBusy}
                      className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-1"
                    >
                      {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Visual Flow */}
            {!isEditing && (
              <div className="p-4">
                <div className="flex items-center gap-2 overflow-x-auto">
                  {workflow.levels.map((level, idx) => (
                    <div key={level.id || idx} className="flex items-center gap-3 flex-shrink-0">
                      <div
                        className={`px-4 py-3 rounded-lg border text-center min-w-[160px] ${
                          level.autoApprove
                            ? 'border-green-500/40 bg-green-500/10'
                            : 'border-blue-500/40 bg-blue-500/10'
                        }`}
                      >
                        <div className="text-sm font-semibold text-[var(--ff-text-primary)]">
                          {level.name}
                        </div>
                        <div className="text-xs text-[var(--ff-text-secondary)] mt-1 font-medium">
                          {formatAmount(level.minAmount)}
                          {level.maxAmount ? ` - ${formatAmount(level.maxAmount)}` : '+'}
                        </div>
                        <div className="text-xs mt-1.5 flex items-center justify-center gap-1">
                          {level.autoApprove ? (
                            <span className="text-green-400 font-medium flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" /> Auto
                            </span>
                          ) : level.approverType === 'user' && level.approverName ? (
                            <span className="text-blue-300 flex items-center gap-1">
                              <User className="w-3.5 h-3.5" /> {level.approverName}
                            </span>
                          ) : (
                            <span className="text-blue-300 flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" /> {level.approverRole || 'any'}
                            </span>
                          )}
                        </div>
                      </div>
                      {idx < workflow.levels.length - 1 && (
                        <ArrowRight className="w-5 h-5 text-[var(--ff-text-secondary)] flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Edit Mode */}
            {isEditing && (
              <div className="p-4 space-y-3">
                {workflow.levels.map((level, idx) => (
                  <div
                    key={level.id || idx}
                    className="p-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--ff-text-secondary)]">
                        Level {idx + 1}
                      </span>
                      {workflow.levels.length > 1 && (
                        <button
                          onClick={() => removeLevel(workflow.id, idx)}
                          className="text-red-400 hover:text-red-300 p-1"
                          title="Remove level"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Name */}
                      <div>
                        <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">Name</label>
                        <input
                          type="text"
                          value={level.name}
                          onChange={e => updateLevel(workflow.id, idx, { name: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                        />
                      </div>

                      {/* Min Amount */}
                      <div>
                        <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">Min Amount (R)</label>
                        <input
                          type="number"
                          value={level.minAmount}
                          onChange={e => updateLevel(workflow.id, idx, { minAmount: parseFloat(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                        />
                      </div>

                      {/* Max Amount */}
                      <div>
                        <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">Max Amount (R)</label>
                        <input
                          type="number"
                          value={level.maxAmount ?? ''}
                          placeholder="No limit"
                          onChange={e => updateLevel(workflow.id, idx, {
                            maxAmount: e.target.value ? parseFloat(e.target.value) : null
                          })}
                          className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                        />
                      </div>

                      {/* Auto-approve toggle */}
                      <div>
                        <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">Auto-approve</label>
                        <button
                          onClick={() => updateLevel(workflow.id, idx, { autoApprove: !level.autoApprove })}
                          className="flex items-center gap-1 mt-0.5"
                        >
                          {level.autoApprove ? (
                            <ToggleRight className="w-6 h-6 text-green-400" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-[var(--ff-text-tertiary)]" />
                          )}
                          <span className="text-xs text-[var(--ff-text-secondary)]">
                            {level.autoApprove ? 'Yes' : 'No'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Approver Assignment (only when not auto-approve) */}
                    {!level.autoApprove && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">Approver Type</label>
                          <select
                            value={level.approverType}
                            onChange={e => updateLevel(workflow.id, idx, {
                              approverType: e.target.value as 'user' | 'role',
                              approverUserId: null,
                              approverRole: null,
                              approverName: null,
                            })}
                            className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                          >
                            <option value="role">By Role</option>
                            <option value="user">Specific User</option>
                          </select>
                        </div>

                        {level.approverType === 'role' ? (
                          <div>
                            <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">Role</label>
                            <select
                              value={level.approverRole || ''}
                              onChange={e => updateLevel(workflow.id, idx, { approverRole: e.target.value })}
                              className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                            >
                              <option value="">Select role...</option>
                              <option value="admin">Admin</option>
                              <option value="super_admin">Super Admin</option>
                              <option value="manager">Manager</option>
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="text-xs font-medium text-[var(--ff-text-secondary)] block mb-1">User</label>
                            <select
                              value={level.approverUserId || ''}
                              onChange={e => {
                                const user = availableUsers.find(u => u.id === e.target.value);
                                updateLevel(workflow.id, idx, {
                                  approverUserId: e.target.value || null,
                                  approverName: user?.name || null,
                                });
                              }}
                              className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                            >
                              <option value="">Select user...</option>
                              {availableUsers.map(u => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.role})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={() => addLevel(workflow.id)}
                  className="w-full py-2 border border-dashed border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-primary-400)] transition-colors text-sm flex items-center justify-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Level
                </button>

                {/* Escalation */}
                <div className="flex items-center gap-4 p-3 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)]">
                  <button
                    onClick={() => setWorkflows(prev =>
                      prev.map(w => w.id === workflow.id
                        ? { ...w, escalationEnabled: !w.escalationEnabled }
                        : w
                      )
                    )}
                    className="flex items-center gap-1"
                  >
                    {workflow.escalationEnabled ? (
                      <ToggleRight className="w-5 h-5 text-green-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
                    )}
                  </button>
                  <div className="text-sm text-[var(--ff-text-primary)]">
                    Escalation
                  </div>
                  {workflow.escalationEnabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--ff-text-secondary)]">after</span>
                      <input
                        type="number"
                        value={workflow.escalationHours}
                        onChange={e => setWorkflows(prev =>
                          prev.map(w => w.id === workflow.id
                            ? { ...w, escalationHours: parseInt(e.target.value) || 48 }
                            : w
                          )
                        )}
                        className="w-16 px-2 py-1 text-sm rounded-md bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)]"
                      />
                      <span className="text-xs text-[var(--ff-text-secondary)]">hours</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
