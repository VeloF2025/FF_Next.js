/**
 * User Permissions Modal
 * Modal for managing user-level permission overrides
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, Shield, Plus, Trash2, Check, AlertCircle,
  ChevronRight, ChevronDown, Search
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
  const [permissions, setPermissions] = useState<PermissionWithSource[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [showOnlyOverrides, setShowOnlyOverrides] = useState(false);

  // Fetch user permissions
  const fetchPermissions = useCallback(async () => {
    if (!user.id) return;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/users/${user.id}/permissions`);
      const data = await res.json();

      if (data.success) {
        setPermissions(data.data.permissions);
      } else {
        setError(data.error?.message || 'Failed to fetch permissions');
      }
    } catch (err) {
      setError('Failed to fetch permissions');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    if (isOpen) {
      fetchPermissions();
    }
  }, [isOpen, fetchPermissions]);

  // Group permissions by module
  const groupedPermissions = permissions.reduce((acc, perm) => {
    if (perm.type === 'module') {
      if (!acc[perm.key]) {
        acc[perm.key] = { module: perm, children: [] };
      } else {
        acc[perm.key].module = perm;
      }
    } else {
      const moduleKey = perm.key.split('.')[0];
      if (!acc[moduleKey]) {
        acc[moduleKey] = { module: null, children: [] };
      }
      acc[moduleKey].children.push(perm);
    }
    return acc;
  }, {} as Record<string, { module: PermissionWithSource | null; children: PermissionWithSource[] }>);

  // Filter permissions
  const filteredGroups = Object.entries(groupedPermissions).filter(([key, group]) => {
    const matchesSearch = !searchTerm ||
      key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.module?.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.children.some(c =>
        c.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.key.toLowerCase().includes(searchTerm.toLowerCase())
      );

    const matchesOverrideFilter = !showOnlyOverrides ||
      group.module?.override ||
      group.children.some(c => c.override);

    return matchesSearch && matchesOverrideFilter;
  });

  // Toggle override for a permission
  const toggleOverride = async (
    permKey: string,
    action: keyof PermissionActions,
    currentPerm: PermissionWithSource
  ) => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const currentEffective = currentPerm.effectiveActions[action];
      const currentRole = currentPerm.roleActions[action];

      // Determine what override to apply
      let overrideType: 'grant' | 'revoke';
      let newActions: PermissionActions;

      if (currentPerm.override) {
        // Modify existing override
        newActions = { ...currentPerm.override.actions };

        if (currentEffective) {
          // Currently enabled - want to disable
          if (currentRole) {
            // Role grants it, need to revoke
            overrideType = 'revoke';
            newActions[action] = true;
          } else {
            // Override grants it, remove the grant
            overrideType = currentPerm.override.type;
            newActions[action] = false;
          }
        } else {
          // Currently disabled - want to enable
          if (currentRole) {
            // Role grants it but override revokes - remove the revoke
            overrideType = currentPerm.override.type;
            newActions[action] = false;
          } else {
            // Role doesn't grant it, need to grant
            overrideType = 'grant';
            newActions[action] = true;
          }
        }

        // Check if all override actions are false - if so, remove override
        const hasAnyOverride = Object.values(newActions).some(v => v);
        if (!hasAnyOverride) {
          // Remove override entirely
          const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissionKey: permKey }),
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.error?.message || 'Failed to remove override');
          }
          setSuccessMessage('Permission reverted to role-based');
          await fetchPermissions();
          onPermissionsUpdated?.();
          return;
        }
      } else {
        // No existing override - create new one
        newActions = { view: false, create: false, edit: false, delete: false };

        if (currentEffective) {
          // Currently enabled via role - revoke it
          overrideType = 'revoke';
          newActions[action] = true;
        } else {
          // Currently disabled - grant it
          overrideType = 'grant';
          newActions[action] = true;
        }
      }

      const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissionKey: permKey,
          overrideType,
          actions: newActions,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to update permission');
      }

      setSuccessMessage(`Permission ${overrideType === 'grant' ? 'granted' : 'revoked'}`);
      await fetchPermissions();
      onPermissionsUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      setSaving(false);
    }
  };

  // Remove all overrides for a permission
  const removeOverride = async (permKey: string) => {
    try {
      setSaving(true);
      setError(null);

      const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionKey: permKey }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to remove override');
      }

      setSuccessMessage('Permission reverted to role-based');
      await fetchPermissions();
      onPermissionsUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove override');
    } finally {
      setSaving(false);
    }
  };

  // Toggle module expansion
  const toggleModule = (key: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Render permission checkbox
  const renderPermissionCheckbox = (
    perm: PermissionWithSource,
    action: keyof PermissionActions
  ) => {
    const effective = perm.effectiveActions[action];
    const fromRole = perm.roleActions[action];
    const hasOverride = perm.override && perm.override.actions[action];

    // Determine visual state
    let bgColor = 'bg-[var(--ff-bg-tertiary)]';
    let borderColor = 'border-[var(--ff-border-light)]';
    let icon = null;

    if (effective) {
      if (hasOverride && perm.override?.type === 'grant') {
        // Granted via override
        bgColor = 'bg-blue-500';
        borderColor = 'border-blue-500';
        icon = <Plus className="w-3 h-3 text-white" />;
      } else {
        // Granted via role
        bgColor = 'bg-green-500';
        borderColor = 'border-green-500';
        icon = <Check className="w-3 h-3 text-white" />;
      }
    } else if (hasOverride && perm.override?.type === 'revoke') {
      // Revoked via override (role would grant)
      bgColor = 'bg-red-500/50';
      borderColor = 'border-red-500';
      icon = <X className="w-3 h-3 text-white" />;
    }

    return (
      <button
        onClick={() => toggleOverride(perm.key, action, perm)}
        disabled={saving}
        className={`w-6 h-6 rounded border-2 ${bgColor} ${borderColor} flex items-center justify-center transition-colors hover:opacity-80 disabled:opacity-50`}
        title={`${action}: ${effective ? 'Enabled' : 'Disabled'}${hasOverride ? ' (custom)' : fromRole ? ' (from role)' : ''}`}
      >
        {icon}
      </button>
    );
  };

  // Render single permission row
  const renderPermissionRow = (perm: PermissionWithSource, indent: number = 0) => (
    <div
      key={perm.key}
      className={`flex items-center justify-between py-2 px-3 hover:bg-[var(--ff-bg-tertiary)] rounded ${indent > 0 ? 'ml-6' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[var(--ff-text-primary)] truncate">
            {perm.label}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            perm.type === 'module' ? 'bg-blue-500/20 text-blue-400' :
            perm.type === 'page' ? 'bg-green-500/20 text-green-400' :
            'bg-purple-500/20 text-purple-400'
          }`}>
            {perm.type}
          </span>
          {perm.override && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              perm.override.type === 'grant'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              {perm.override.type === 'grant' ? '+ Custom Grant' : '- Custom Revoke'}
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--ff-text-tertiary)] truncate">{perm.key}</div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--ff-text-tertiary)] w-8 text-center">View</span>
          {renderPermissionCheckbox(perm, 'view')}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--ff-text-tertiary)] w-10 text-center">Create</span>
          {renderPermissionCheckbox(perm, 'create')}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--ff-text-tertiary)] w-8 text-center">Edit</span>
          {renderPermissionCheckbox(perm, 'edit')}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--ff-text-tertiary)] w-10 text-center">Delete</span>
          {renderPermissionCheckbox(perm, 'delete')}
        </div>

        {perm.override && (
          <button
            onClick={() => removeOverride(perm.key)}
            disabled={saving}
            className="p-1 text-red-400 hover:bg-red-500/20 rounded"
            title="Remove custom override (revert to role-based)"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-primary)] w-full max-w-4xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col">
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
                {user.email} • Role: {user.roleDisplayName}
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

        {/* Legend */}
        <div className="px-6 py-3 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
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
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mx-6 mt-4 flex items-center p-3 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30">
            <AlertCircle className="w-4 h-4 mr-2" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 flex items-center p-3 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30">
            <Check className="w-4 h-4 mr-2" />
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
            Show only custom overrides
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
              {filteredGroups.map(([moduleKey, group]) => (
                <div key={moduleKey} className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
                  {/* Module header */}
                  <button
                    onClick={() => toggleModule(moduleKey)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-secondary)] text-left"
                  >
                    <div className="flex items-center gap-2">
                      {expandedModules.has(moduleKey) ? (
                        <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      )}
                      <span className="font-medium text-[var(--ff-text-primary)]">
                        {group.module?.label || moduleKey}
                      </span>
                      {(group.module?.override || group.children.some(c => c.override)) && (
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                          Has Overrides
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-[var(--ff-text-tertiary)]">
                      {group.children.length} permissions
                    </span>
                  </button>

                  {/* Module permissions */}
                  {expandedModules.has(moduleKey) && (
                    <div className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                      {group.module && renderPermissionRow(group.module)}
                      {group.children.map(child => renderPermissionRow(child, 1))}
                    </div>
                  )}
                </div>
              ))}

              {filteredGroups.length === 0 && (
                <div className="text-center py-12 text-[var(--ff-text-secondary)]">
                  {showOnlyOverrides
                    ? 'No custom permission overrides found'
                    : 'No permissions found matching your search'
                  }
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--ff-border-light)] flex items-center justify-between">
          <div className="text-sm text-[var(--ff-text-secondary)]">
            Click checkboxes to toggle permissions. Changes are saved automatically.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
