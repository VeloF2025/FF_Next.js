/**
 * User Permissions Modal
 * Batch-edit user permissions with local state, then save all at once.
 * Includes "Save as Role Template" and "Update Existing Role" features.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Loader2, Shield, Plus, Check, AlertCircle,
  ChevronRight, ChevronDown, Search, Save, RotateCcw, Download, Upload
} from 'lucide-react';

interface PermissionActions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

interface PermissionWithSource {
  key: string;
  label: string;
  type: string;
  parentKey: string | null;
  roleActions: PermissionActions;
  override: {
    type: 'grant' | 'revoke';
    actions: PermissionActions;
    reason: string | null;
    grantedAt: string;
    expiresAt: string | null;
  } | null;
  effectiveActions: PermissionActions;
}

interface RoleInfo {
  name: string;
  displayName: string;
  isSystem: boolean;
}

interface UserPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    roleDisplayName: string;
  };
  onPermissionsUpdated?: () => void;
}

export function UserPermissionsModal({
  isOpen,
  onClose,
  user,
  onPermissionsUpdated,
}: UserPermissionsModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [showOnlyOverrides, setShowOnlyOverrides] = useState(false);

  // Original permissions from server (read-only reference)
  const [serverPermissions, setServerPermissions] = useState<PermissionWithSource[]>([]);

  // Local editable state - tracks desired effective actions per permission
  const [localActions, setLocalActions] = useState<Map<string, PermissionActions>>(new Map());

  // Role template modals
  const [showSaveAsRole, setShowSaveAsRole] = useState(false);
  const [showUpdateRole, setShowUpdateRole] = useState(false);
  const [roles, setRoles] = useState<RoleInfo[]>([]);

  // Fetch user permissions
  const fetchPermissions = useCallback(async () => {
    if (!user.id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/users/${user.id}/permissions`);
      const data = await res.json();

      if (data.success) {
        const perms = data.data.permissions as PermissionWithSource[];
        setServerPermissions(perms);
        // Initialize local state from effective actions
        const map = new Map<string, PermissionActions>();
        for (const p of perms) {
          map.set(p.key, { ...p.effectiveActions });
        }
        setLocalActions(map);
      } else {
        setError(data.error?.message || 'Failed to fetch permissions');
      }
    } catch {
      setError('Failed to fetch permissions');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  // Fetch roles for template features
  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/roles');
      const data = await res.json();
      if (data.success) {
        setRoles(data.data.roles.map((r: { name: string; displayName: string; isSystem: boolean }) => ({
          name: r.name,
          displayName: r.displayName,
          isSystem: r.isSystem,
        })));
      }
    } catch {
      // Non-critical, ignore
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchPermissions();
      fetchRoles();
    }
  }, [isOpen, fetchPermissions, fetchRoles]);

  // Compute which permissions have been changed from server state
  const changeCount = useMemo(() => {
    let count = 0;
    for (const perm of serverPermissions) {
      const local = localActions.get(perm.key);
      if (!local) continue;
      const server = perm.effectiveActions;
      if (
        local.view !== server.view ||
        local.create !== server.create ||
        local.edit !== server.edit ||
        local.delete !== server.delete
      ) {
        count++;
      }
    }
    return count;
  }, [serverPermissions, localActions]);

  const hasChanges = changeCount > 0;

  // Toggle a single action locally (no API call)
  const toggleAction = (permKey: string, action: keyof PermissionActions) => {
    setLocalActions(prev => {
      const next = new Map(prev);
      const current = next.get(permKey);
      if (current) {
        next.set(permKey, { ...current, [action]: !current[action] });
      }
      return next;
    });
  };

  // Toggle all actions for a permission
  const toggleAllActions = (permKey: string) => {
    setLocalActions(prev => {
      const next = new Map(prev);
      const current = next.get(permKey);
      if (current) {
        const allEnabled = current.view && current.create && current.edit && current.delete;
        const newVal = !allEnabled;
        next.set(permKey, { view: newVal, create: newVal, edit: newVal, delete: newVal });
      }
      return next;
    });
  };

  // Toggle all permissions for a module
  const toggleModule = (moduleKey: string, enable: boolean) => {
    setLocalActions(prev => {
      const next = new Map(prev);
      for (const perm of serverPermissions) {
        if (perm.key === moduleKey || perm.key.startsWith(moduleKey + '.')) {
          next.set(perm.key, {
            view: enable, create: enable, edit: enable, delete: enable,
          });
        }
      }
      return next;
    });
  };

  // Discard changes
  const discardChanges = () => {
    const map = new Map<string, PermissionActions>();
    for (const p of serverPermissions) {
      map.set(p.key, { ...p.effectiveActions });
    }
    setLocalActions(map);
    setSuccessMessage(null);
    setError(null);
  };

  // Save all changes
  const saveChanges = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Build desired permissions array
      const desiredPermissions = serverPermissions.map(p => ({
        key: p.key,
        actions: localActions.get(p.key) || { view: false, create: false, edit: false, delete: false },
      }));

      const res = await fetch(`/api/admin/users/${user.id}/permissions-batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desiredPermissions }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to save permissions');
      }

      setSuccessMessage(
        `Saved: ${data.data.overridesCreated} override(s) set, ${data.data.overridesRemoved} removed`
      );
      // Refresh from server
      await fetchPermissions();
      onPermissionsUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  // Group permissions by module
  const groupedPermissions = useMemo(() => {
    const groups: Record<string, { module: PermissionWithSource | null; children: PermissionWithSource[] }> = {};
    for (const perm of serverPermissions) {
      if (perm.type === 'module') {
        const existing = groups[perm.key];
        if (!existing) {
          groups[perm.key] = { module: perm, children: [] };
        } else {
          existing.module = perm;
        }
      } else {
        const moduleKey = perm.key.split('.')[0] ?? perm.key;
        const existing = groups[moduleKey];
        if (!existing) {
          groups[moduleKey] = { module: null, children: [perm] };
        } else {
          existing.children.push(perm);
        }
      }
    }
    return groups;
  }, [serverPermissions]);

  // Filter
  const filteredGroups = useMemo(() => {
    return Object.entries(groupedPermissions).filter(([key, group]) => {
      const matchesSearch = !searchTerm ||
        key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.module?.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        group.children.some(c =>
          c.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.key.toLowerCase().includes(searchTerm.toLowerCase())
        );

      const matchesOverrideFilter = !showOnlyOverrides || (() => {
        // Show if any permission in this module has local changes
        const allPerms = group.module ? [group.module, ...group.children] : group.children;
        return allPerms.some(p => {
          const local = localActions.get(p.key);
          return local && (
            local.view !== p.roleActions.view ||
            local.create !== p.roleActions.create ||
            local.edit !== p.roleActions.edit ||
            local.delete !== p.roleActions.delete
          );
        });
      })();

      return matchesSearch && matchesOverrideFilter;
    }).sort(([keyA, groupA], [keyB, groupB]) => {
      const labelA = groupA.module?.label ?? keyA;
      const labelB = groupB.module?.label ?? keyB;
      return labelA.localeCompare(labelB);
    });
  }, [groupedPermissions, searchTerm, showOnlyOverrides, localActions, serverPermissions]);

  // Expand/collapse module
  const toggleModuleExpand = (key: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Render permission checkbox
  const renderCheckbox = (perm: PermissionWithSource, action: keyof PermissionActions) => {
    const local = localActions.get(perm.key);
    const effective = local ? local[action] : false;
    const serverVal = perm.effectiveActions[action];
    const roleVal = perm.roleActions[action];
    const isChanged = effective !== serverVal;

    // Color logic
    let bgColor = 'bg-[var(--ff-bg-tertiary)]';
    let borderColor = 'border-[var(--ff-border-light)]';
    let icon = null;

    if (effective) {
      if (effective !== roleVal) {
        // Different from role → custom (blue)
        bgColor = 'bg-blue-500';
        borderColor = 'border-blue-500';
        icon = <Plus className="w-3 h-3 text-white" />;
      } else {
        // Same as role → from role (green)
        bgColor = 'bg-green-500';
        borderColor = 'border-green-500';
        icon = <Check className="w-3 h-3 text-white" />;
      }
    } else if (roleVal) {
      // Role grants but we're revoking → red
      bgColor = 'bg-red-500/50';
      borderColor = 'border-red-500';
      icon = <X className="w-3 h-3 text-white" />;
    }

    return (
      <button
        onClick={() => toggleAction(perm.key, action)}
        disabled={saving}
        className={`w-6 h-6 rounded border-2 ${bgColor} ${borderColor} flex items-center justify-center transition-colors hover:opacity-80 disabled:opacity-50 ${
          isChanged ? 'ring-2 ring-yellow-400/50' : ''
        }`}
        title={`${action}: ${effective ? 'Enabled' : 'Disabled'}${isChanged ? ' (unsaved)' : ''}`}
      >
        {icon}
      </button>
    );
  };

  // Render permission row
  const renderRow = (perm: PermissionWithSource, indent: number = 0) => {
    const local = localActions.get(perm.key);
    const serverEffective = perm.effectiveActions;
    const isChanged = local && (
      local.view !== serverEffective.view ||
      local.create !== serverEffective.create ||
      local.edit !== serverEffective.edit ||
      local.delete !== serverEffective.delete
    );

    return (
      <div
        key={perm.key}
        className={`flex items-center justify-between py-2 px-3 hover:bg-[var(--ff-bg-tertiary)] rounded ${
          indent > 0 ? 'ml-6' : ''
        } ${isChanged ? 'bg-yellow-500/5' : ''}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleAllActions(perm.key)}
              className="font-medium text-sm text-[var(--ff-text-primary)] truncate hover:underline"
              title="Click to toggle all actions"
            >
              {perm.label}
            </button>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              perm.type === 'module' ? 'bg-blue-500/20 text-blue-400' :
              perm.type === 'page' ? 'bg-green-500/20 text-green-400' :
              'bg-purple-500/20 text-purple-400'
            }`}>
              {perm.type}
            </span>
            {isChanged && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                Modified
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)] truncate">{perm.key}</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--ff-text-tertiary)] w-8 text-center">View</span>
            {renderCheckbox(perm, 'view')}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--ff-text-tertiary)] w-10 text-center">Create</span>
            {renderCheckbox(perm, 'create')}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--ff-text-tertiary)] w-8 text-center">Edit</span>
            {renderCheckbox(perm, 'edit')}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--ff-text-tertiary)] w-10 text-center">Delete</span>
            {renderCheckbox(perm, 'delete')}
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label="User Permissions" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-[var(--ff-bg-primary)] w-full max-w-4xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col mx-4 sm:mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Edit Permissions: {user.fullName}
                </h2>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {user.email} &bull; Role: {user.roleDisplayName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </button>
          </div>

          {/* Legend + Quick Actions */}
          <div className="px-6 py-3 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                  <span className="text-[var(--ff-text-secondary)]">From Role</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500 rounded flex items-center justify-center">
                    <Plus className="w-2.5 h-2.5 text-white" />
                  </div>
                  <span className="text-[var(--ff-text-secondary)]">Custom Grant</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-500/50 rounded border border-red-500 flex items-center justify-center">
                    <X className="w-2.5 h-2.5 text-white" />
                  </div>
                  <span className="text-[var(--ff-text-secondary)]">Custom Revoke</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-[var(--ff-bg-tertiary)] rounded border border-[var(--ff-border-light)]" />
                  <span className="text-[var(--ff-text-secondary)]">No Access</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded ring-2 ring-yellow-400/50 border border-[var(--ff-border-light)]" />
                  <span className="text-[var(--ff-text-secondary)]">Unsaved</span>
                </div>
              </div>
            </div>
          </div>

          {/* Messages */}
          {error && (
            <div className="mx-6 mt-4 flex items-center p-3 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30">
              <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
              {error}
              <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {successMessage && (
            <div className="mx-6 mt-4 flex items-center p-3 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30">
              <Check className="w-4 h-4 mr-2 flex-shrink-0" />
              {successMessage}
              <button onClick={() => setSuccessMessage(null)} className="ml-auto hover:text-green-300">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Filters */}
          <div className="px-6 py-3 flex items-center gap-4 border-b border-[var(--ff-border-light)]">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search permissions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
              <input
                type="checkbox"
                checked={showOnlyOverrides}
                onChange={(e) => setShowOnlyOverrides(e.target.checked)}
                className="rounded"
              />
              Show only changes
            </label>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGroups.map(([moduleKey, group]) => {
                  // Check if any permission in this module has local changes
                  const allPerms = group.module ? [group.module, ...group.children] : group.children;
                  const moduleHasChanges = allPerms.some(p => {
                    const local = localActions.get(p.key);
                    return local && (
                      local.view !== p.effectiveActions.view ||
                      local.create !== p.effectiveActions.create ||
                      local.edit !== p.effectiveActions.edit ||
                      local.delete !== p.effectiveActions.delete
                    );
                  });

                  // Check if module has any enabled permissions locally
                  const _moduleEnabled = allPerms.some(p => {
                    const local = localActions.get(p.key);
                    return local && (local.view || local.create || local.edit || local.delete);
                  });

                  return (
                    <div key={moduleKey} className={`border rounded-lg overflow-hidden ${
                      moduleHasChanges
                        ? 'border-yellow-500/30'
                        : 'border-[var(--ff-border-light)]'
                    }`}>
                      {/* Module header */}
                      <div className="flex items-center justify-between bg-[var(--ff-bg-tertiary)]">
                        <button
                          onClick={() => toggleModuleExpand(moduleKey)}
                          className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-[var(--ff-bg-secondary)] text-left"
                        >
                          {expandedModules.has(moduleKey) ? (
                            <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                          )}
                          <span className="font-medium text-[var(--ff-text-primary)]">
                            {group.module?.label || moduleKey}
                          </span>
                          {moduleHasChanges && (
                            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                              Modified
                            </span>
                          )}
                          <span className="text-xs text-[var(--ff-text-tertiary)]">
                            {group.children.length} permissions
                          </span>
                        </button>
                        {/* Quick enable/disable all for this module */}
                        <div className="flex items-center gap-1 pr-4">
                          <button
                            onClick={() => toggleModule(moduleKey, true)}
                            disabled={saving}
                            className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50"
                            title="Enable all permissions for this module"
                          >
                            All
                          </button>
                          <button
                            onClick={() => toggleModule(moduleKey, false)}
                            disabled={saving}
                            className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                            title="Disable all permissions for this module"
                          >
                            None
                          </button>
                        </div>
                      </div>

                      {/* Module permissions */}
                      {expandedModules.has(moduleKey) && (
                        <div className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                          {group.module && renderRow(group.module)}
                          {group.children.map(child => renderRow(child, 1))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredGroups.length === 0 && (
                  <div className="text-center py-12 text-[var(--ff-text-secondary)]">
                    {showOnlyOverrides
                      ? 'No changed permissions found'
                      : 'No permissions found matching your search'
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--ff-border-light)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {/* Save as Role Template */}
              <button
                onClick={() => setShowSaveAsRole(true)}
                className="flex items-center text-xs px-3 py-2 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                title="Save current permissions as a new role template"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Save as Template
              </button>
              {/* Update Existing Role */}
              <button
                onClick={() => setShowUpdateRole(true)}
                className="flex items-center text-xs px-3 py-2 rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                title="Update an existing role template with these permissions"
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                Update Role
              </button>
            </div>

            <div className="flex items-center gap-3">
              {hasChanges && (
                <span className="text-sm text-yellow-400">
                  {changeCount} permission{changeCount !== 1 ? 's' : ''} changed
                </span>
              )}
              <button
                onClick={discardChanges}
                disabled={!hasChanges || saving}
                className="flex items-center px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg disabled:opacity-30"
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Discard
              </button>
              <button
                onClick={saveChanges}
                disabled={!hasChanges || saving}
                className="flex items-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save as Role Template Modal */}
      {showSaveAsRole && (
        <SaveAsRoleModalInline
          userId={user.id}
          userFullName={user.fullName}
          onClose={() => setShowSaveAsRole(false)}
          onSuccess={() => {
            setShowSaveAsRole(false);
            setSuccessMessage('Role template created successfully');
            fetchRoles();
            onPermissionsUpdated?.();
          }}
        />
      )}

      {/* Update Existing Role Modal */}
      {showUpdateRole && (
        <UpdateRoleModalInline
          userId={user.id}
          userFullName={user.fullName}
          roles={roles}
          onClose={() => setShowUpdateRole(false)}
          onSuccess={(roleName) => {
            setShowUpdateRole(false);
            setSuccessMessage(`Role "${roleName}" updated with user's permissions`);
            fetchRoles();
            onPermissionsUpdated?.();
          }}
        />
      )}
    </>
  );
}

// ============ Inline Sub-Modals ============

function SaveAsRoleModalInline({
  userId,
  userFullName,
  onClose,
  onSuccess,
}: {
  userId: string;
  userFullName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name || !displayName) {
      setError('Role name and display name are required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await fetch('/api/admin/roles/from-user-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          name: name.toLowerCase().replace(/\s+/g, '_'),
          displayName,
          description: description || null,
          mode: 'create',
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to create role');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
          Save as Role Template
        </h3>
        <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
          Create a new role from <span className="font-medium text-[var(--ff-text-primary)]">{userFullName}</span>&apos;s effective permissions
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Role Name (internal)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="e.g., qa_reviewer"
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
            />
            <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
              Lowercase letters, numbers, and underscores only
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., QA Reviewer"
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this role's purpose..."
              rows={2}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name || !displayName || saving}
            className="flex items-center px-4 py-2 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create Role Template
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdateRoleModalInline({
  userId,
  userFullName,
  roles,
  onClose,
  onSuccess,
}: {
  userId: string;
  userFullName: string;
  roles: RoleInfo[];
  onClose: () => void;
  onSuccess: (roleName: string) => void;
}) {
  const [selectedRole, setSelectedRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out super_admin
  const editableRoles = roles.filter(r => r.name !== 'super_admin');

  const handleUpdate = async () => {
    if (!selectedRole) {
      setError('Please select a role to update');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await fetch('/api/admin/roles/from-user-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          mode: 'update',
          existingRole: selectedRole,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to update role');
      }

      const role = editableRoles.find(r => r.name === selectedRole);
      onSuccess(role?.displayName || selectedRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
          Update Existing Role
        </h3>
        <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
          Replace a role&apos;s permissions with <span className="font-medium text-[var(--ff-text-primary)]">{userFullName}</span>&apos;s effective permissions
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Select Role to Update
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
            >
              <option value="">Choose a role...</option>
              {editableRoles.map(r => (
                <option key={r.name} value={r.name}>
                  {r.displayName} {r.isSystem ? '(system)' : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedRole && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-sm text-yellow-400">
                This will <strong>replace ALL permissions</strong> for the &quot;{editableRoles.find(r => r.name === selectedRole)?.displayName}&quot; role
                with {userFullName}&apos;s current effective permissions. This affects all users with this role.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
            Cancel
          </button>
          <button
            onClick={handleUpdate}
            disabled={!selectedRole || saving}
            className="flex items-center px-4 py-2 text-sm text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Update Role
          </button>
        </div>
      </div>
    </div>
  );
}
