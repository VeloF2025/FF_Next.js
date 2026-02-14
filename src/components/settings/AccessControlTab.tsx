/**
 * Access Control Tab - RBAC Admin UI
 * Manage users, roles, and permissions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Users, Shield, Key, Search, ChevronRight, ChevronDown,
  Check, X, AlertCircle, Loader2, RefreshCw, UserCog, UserPlus, Settings,
  Plus, Copy, Trash2, Lock, XCircle, Filter, ToggleLeft, ToggleRight,
  ShieldCheck, ShieldOff, UserCheck, UserX, Save, RotateCcw
} from 'lucide-react';
import { UserPermissionsModal } from './UserPermissionsModal';

// Custom Toggle Switch Component
function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  activeColor = 'green',
  label
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  activeColor?: 'green' | 'blue' | 'orange';
  label?: string;
}) {
  const colors = {
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    orange: 'bg-orange-500'
  };
  const sizes = {
    sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' },
    md: { track: 'w-11 h-6', thumb: 'w-5 h-5', translate: 'translate-x-5' }
  };
  const s = sizes[size];

  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex items-center ${s.track} rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[var(--ff-bg-secondary)] ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? colors[activeColor] : 'bg-gray-600'}`}
      title={label}
    >
      <span
        className={`inline-block ${s.thumb} transform rounded-full bg-white dark:bg-gray-800 shadow-lg transition-transform duration-200 ${
          checked ? s.translate : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Types
interface UserWithRole {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  role: string;
  roleDisplayName: string;
  department: string | null;
  position: string | null;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
}

interface RoleWithPermissions {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  isActive: boolean;
  permissions: PermissionWithActions[];
  permissionCount: number;
  userCount: number;
}

interface PermissionWithActions {
  key: string;
  label: string;
  type: string;
  actions: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
  };
}

interface PermissionNode {
  key: string;
  label: string;
  type: string;
  route: string | null;
  children?: PermissionNode[];
}

type ActionFlags = { view: boolean; create: boolean; edit: boolean; delete: boolean };

type SubTab = 'users' | 'roles' | 'permissions';

export function AccessControlTab() {
  const [subTab, setSubTab] = useState<SubTab>('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Users state
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut for search (Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchTerm('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Roles state
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  // Permissions state
  const [permissionTree, setPermissionTree] = useState<PermissionNode[]>([]);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Modal state
  const [selectedUserForPermissions, setSelectedUserForPermissions] = useState<UserWithRole | null>(null);

  // Role management state
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [showCloneRoleModal, setShowCloneRoleModal] = useState(false);
  const [roleToClone, setRoleToClone] = useState<RoleWithPermissions | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<RoleWithPermissions | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDisplayName, setNewRoleDisplayName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  // Roles tab batch editing state
  const [localRolePerms, setLocalRolePerms] = useState<Map<string, ActionFlags>>(new Map());
  const [serverRolePerms, setServerRolePerms] = useState<Map<string, ActionFlags>>(new Map());
  const [roleExpandedModules, setRoleExpandedModules] = useState<Set<string>>(new Set());
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [savingRoleBatch, setSavingRoleBatch] = useState(false);

  // Flatten permission tree into list of all permission keys
  const allFlatPermissions = useMemo(() => {
    const result: { key: string; label: string; type: string }[] = [];
    const flatten = (nodes: PermissionNode[]) => {
      for (const node of nodes) {
        result.push({ key: node.key, label: node.label, type: node.type });
        if (node.children) flatten(node.children);
      }
    };
    flatten(permissionTree);
    return result;
  }, [permissionTree]);

  // Build grouped view for roles tab (top-level modules with flattened children)
  const roleGroupedPermissions = useMemo(() => {
    return permissionTree.map(module => {
      const children: { key: string; label: string; type: string; indent: number }[] = [];
      const flattenChildren = (nodes: PermissionNode[], indent: number) => {
        for (const node of nodes) {
          children.push({ key: node.key, label: node.label, type: node.type, indent });
          if (node.children) flattenChildren(node.children, indent + 1);
        }
      };
      if (module.children) flattenChildren(module.children, 1);
      return { moduleKey: module.key, moduleLabel: module.label, children };
    });
  }, [permissionTree]);

  // Filter role groups by search term
  const filteredRoleGroups = useMemo(() => {
    if (!roleSearchTerm) return roleGroupedPermissions;
    const term = roleSearchTerm.toLowerCase();
    return roleGroupedPermissions
      .map(group => ({
        ...group,
        children: group.children.filter(c =>
          c.label.toLowerCase().includes(term) || c.key.toLowerCase().includes(term)
        ),
      }))
      .filter(group =>
        group.moduleLabel.toLowerCase().includes(term) ||
        group.moduleKey.toLowerCase().includes(term) ||
        group.children.length > 0
      );
  }, [roleGroupedPermissions, roleSearchTerm]);

  // Sync local role permissions when selected role changes
  useEffect(() => {
    if (!selectedRole || allFlatPermissions.length === 0) return;
    const currentRole = roles.find(r => r.name === selectedRole);
    if (!currentRole) return;

    const rolePermMap = new Map<string, ActionFlags>();
    for (const perm of currentRole.permissions) {
      rolePermMap.set(perm.key, { ...perm.actions });
    }

    const fullMap = new Map<string, ActionFlags>();
    for (const perm of allFlatPermissions) {
      fullMap.set(perm.key, rolePermMap.get(perm.key) || { view: false, create: false, edit: false, delete: false });
    }

    setLocalRolePerms(new Map(fullMap));
    setServerRolePerms(new Map(fullMap));
    setRoleSearchTerm('');
  }, [selectedRole, roles, allFlatPermissions]);

  // Compute role change count
  const roleChangeCount = useMemo(() => {
    let count = 0;
    for (const [key, local] of localRolePerms) {
      const server = serverRolePerms.get(key);
      if (!server) continue;
      if (local.view !== server.view || local.create !== server.create ||
          local.edit !== server.edit || local.delete !== server.delete) {
        count++;
      }
    }
    return count;
  }, [localRolePerms, serverRolePerms]);

  // Toggle single action for role permission
  const toggleRolePermAction = (permKey: string, action: keyof ActionFlags) => {
    setLocalRolePerms(prev => {
      const next = new Map(prev);
      const current = next.get(permKey);
      if (current) {
        next.set(permKey, { ...current, [action]: !current[action] });
      }
      return next;
    });
  };

  // Toggle all actions for a single role permission
  const toggleRolePermAll = (permKey: string) => {
    setLocalRolePerms(prev => {
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

  // Toggle all permissions in a module
  const toggleRoleModule = (moduleKey: string, enable: boolean) => {
    setLocalRolePerms(prev => {
      const next = new Map(prev);
      for (const perm of allFlatPermissions) {
        if (perm.key === moduleKey || perm.key.startsWith(moduleKey + '.')) {
          next.set(perm.key, { view: enable, create: enable, edit: enable, delete: enable });
        }
      }
      return next;
    });
  };

  // Toggle role module expand/collapse
  const toggleRoleModuleExpand = (key: string) => {
    setRoleExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Save role permissions batch
  const saveRoleChanges = async () => {
    if (!selectedRole) return;
    try {
      setSavingRoleBatch(true);
      setError(null);

      const permissions = allFlatPermissions.map(p => ({
        key: p.key,
        actions: localRolePerms.get(p.key) || { view: false, create: false, edit: false, delete: false },
      }));

      const res = await fetch(`/api/admin/roles/${selectedRole}/permissions-batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to save role permissions');
      }

      setSuccessMessage(`Role permissions saved (${data.data.permissionsSet} permissions set)`);
      await fetchRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role permissions');
    } finally {
      setSavingRoleBatch(false);
    }
  };

  // Discard role changes
  const discardRoleChanges = () => {
    setLocalRolePerms(new Map(serverRolePerms));
  };

  // Fetch all users once (filtering happens client-side for instant search)
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data.users);
      }
    } catch (err) {
      setError('Failed to fetch users');
    }
  }, []);

  // Fetch roles
  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/roles');
      const data = await res.json();
      if (data.success) {
        setRoles(data.data.roles);
        if (!selectedRole && data.data.roles.length > 0) {
          setSelectedRole(data.data.roles[0].name);
        }
      }
    } catch (err) {
      setError('Failed to fetch roles');
    }
  }, [selectedRole]);

  // Fetch permission tree
  const fetchPermissionTree = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/permissions?tree=true');
      const data = await res.json();
      if (data.success) {
        setPermissionTree(data.data.tree);
      }
    } catch (err) {
      setError('Failed to fetch permissions');
    }
  }, []);

  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(), fetchRoles(), fetchPermissionTree()]);
      setLoading(false);
    };
    loadData();
  }, [fetchUsers, fetchRoles, fetchPermissionTree]);

  // Update user role
  const updateUserRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchUsers();
        await fetchRoles();
      } else {
        setError(data.error?.message || 'Failed to update user role');
      }
    } catch (err) {
      setError('Failed to update user role');
    }
  };

  // Toggle user active status
  const toggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      setUpdatingUserId(userId);
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await res.json();
      if (data.success) {
        // Update locally for instant feedback
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive: !isActive } : u));
      } else {
        setError(data.error?.message || 'Failed to update user status');
      }
    } catch (err) {
      setError('Failed to update user status');
    } finally {
      setUpdatingUserId(null);
    }
  };

  // Quick action: Grant full access
  const grantFullAccess = async (userId: string) => {
    try {
      setUpdatingUserId(userId);
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'super_admin', permissions: ['all'] }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage('Full access granted');
        await fetchUsers();
      } else {
        setError(data.error?.message || 'Failed to grant access');
      }
    } catch (err) {
      setError('Failed to grant access');
    } finally {
      setUpdatingUserId(null);
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

  // Create new role
  const createRole = async () => {
    if (!newRoleName || !newRoleDisplayName) {
      setError('Role name and display name are required');
      return;
    }

    try {
      setSavingRole(true);
      setError(null);

      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoleName.toLowerCase().replace(/\s+/g, '_'),
          displayName: newRoleDisplayName,
          description: newRoleDescription || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMessage(`Role "${newRoleDisplayName}" created successfully`);
        setShowCreateRoleModal(false);
        setNewRoleName('');
        setNewRoleDisplayName('');
        setNewRoleDescription('');
        await fetchRoles();
        setSelectedRole(data.data.name);
      } else {
        setError(data.error?.message || 'Failed to create role');
      }
    } catch (err) {
      setError('Failed to create role');
    } finally {
      setSavingRole(false);
    }
  };

  // Clone role
  const cloneRole = async () => {
    if (!roleToClone || !newRoleName || !newRoleDisplayName) {
      setError('Role name and display name are required');
      return;
    }

    try {
      setSavingRole(true);
      setError(null);

      const res = await fetch('/api/admin/roles/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceRole: roleToClone.name,
          newName: newRoleName.toLowerCase().replace(/\s+/g, '_'),
          newDisplayName: newRoleDisplayName,
          description: newRoleDescription || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMessage(`Role "${newRoleDisplayName}" cloned from "${roleToClone.displayName}" with ${data.data.permissionsCloned} permissions`);
        setShowCloneRoleModal(false);
        setRoleToClone(null);
        setNewRoleName('');
        setNewRoleDisplayName('');
        setNewRoleDescription('');
        await fetchRoles();
        setSelectedRole(data.data.name);
      } else {
        setError(data.error?.message || 'Failed to clone role');
      }
    } catch (err) {
      setError('Failed to clone role');
    } finally {
      setSavingRole(false);
    }
  };

  // Delete role
  const deleteRole = async () => {
    if (!roleToDelete) return;

    try {
      setSavingRole(true);
      setError(null);

      const res = await fetch(`/api/admin/roles/${roleToDelete.name}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMessage(`Role "${roleToDelete.displayName}" deleted successfully`);
        setRoleToDelete(null);
        await fetchRoles();
        if (selectedRole === roleToDelete.name) {
          setSelectedRole(roles[0]?.name || null);
        }
      } else {
        setError(data.error?.message || 'Failed to delete role');
      }
    } catch (err) {
      setError('Failed to delete role');
    } finally {
      setSavingRole(false);
    }
  };

  // Open clone modal
  const openCloneModal = (role: RoleWithPermissions) => {
    setRoleToClone(role);
    setNewRoleName('');
    setNewRoleDisplayName(`${role.displayName} (Copy)`);
    setNewRoleDescription(`Cloned from ${role.displayName}`);
    setShowCloneRoleModal(true);
  };

  // Provision users from staff
  const provisionUsersFromStaff = async () => {
    try {
      setProvisioning(true);
      setError(null);
      setSuccessMessage(null);

      const res = await fetch('/api/admin/users/provision-from-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (data.success) {
        setSuccessMessage(`${data.data.created} new user accounts created. ${data.data.skipped} existing accounts linked.`);
        await fetchUsers();
      } else {
        setError(data.error?.message || 'Failed to provision users');
      }
    } catch (err) {
      setError('Failed to provision users from staff');
    } finally {
      setProvisioning(false);
    }
  };

  // Filter users for display
  // Client-side filtering for instant search (like QA Centre)
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      // Search filter - check name, email, department
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch =
          user.fullName?.toLowerCase().includes(search) ||
          user.email?.toLowerCase().includes(search) ||
          user.department?.toLowerCase().includes(search);
        if (!matchesSearch) return false;
      }

      // Role filter
      if (roleFilter && user.role !== roleFilter) return false;

      // Status filter
      if (statusFilter === 'active' && !user.isActive) return false;
      if (statusFilter === 'inactive' && user.isActive) return false;

      // Department filter
      if (departmentFilter && user.department !== departmentFilter) return false;

      return true;
    });
  }, [users, searchTerm, roleFilter, statusFilter, departmentFilter]);

  // Stats
  const userStats = useMemo(() => {
    const active = users.filter(u => u.isActive).length;
    const inactive = users.length - active;
    const admins = users.filter(u => u.role === 'super_admin' || u.role === 'admin').length;
    return { total: users.length, active, inactive, admins };
  }, [users]);

  // Extract unique departments from users
  const departments = useMemo(() => {
    const depts = users
      .map(u => u.department)
      .filter((d): d is string => Boolean(d));
    return [...new Set(depts)].sort();
  }, [users]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchTerm) count++;
    if (roleFilter) count++;
    if (statusFilter) count++;
    if (departmentFilter) count++;
    return count;
  }, [searchTerm, roleFilter, statusFilter, departmentFilter]);

  // Check if any filters are active
  const hasActiveFilters = activeFilterCount > 0;

  // Clear all filters
  const clearAllFilters = () => {
    setSearchTerm('');
    setRoleFilter('');
    setStatusFilter('');
    setDepartmentFilter('');
  };

  // Render users tab
  const renderUsersTab = () => (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Users</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{userStats.total}</p>
            </div>
            <Users className="w-8 h-8 text-blue-400 opacity-50" />
          </div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Active</p>
              <p className="text-2xl font-bold text-green-400">{userStats.active}</p>
            </div>
            <UserCheck className="w-8 h-8 text-green-400 opacity-50" />
          </div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Inactive</p>
              <p className="text-2xl font-bold text-red-400">{userStats.inactive}</p>
            </div>
            <UserX className="w-8 h-8 text-red-400 opacity-50" />
          </div>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Admins</p>
              <p className="text-2xl font-bold text-orange-400">{userStats.admins}</p>
            </div>
            <ShieldCheck className="w-8 h-8 text-orange-400 opacity-50" />
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        {/* Main Search Bar */}
        <div className="p-4">
          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by name, email, or department... (Ctrl+K)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--ff-bg-primary)] rounded"
                >
                  <XCircle className="w-4 h-4 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]" />
                </button>
              )}
            </div>

            {/* Filters Toggle Button */}
            <button
              onClick={() => setShowFiltersPanel(!showFiltersPanel)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors ${
                showFiltersPanel || hasActiveFilters
                  ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                  : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-medium">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
              >
                <X className="w-4 h-4" />
                <span>Clear</span>
              </button>
            )}
          </div>


          {/* Active Filter Pills */}
          {hasActiveFilters && (
            <div className="mt-3 flex flex-wrap gap-2">
              {searchTerm && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs">
                  Search: &quot;{searchTerm}&quot;
                  <button onClick={() => setSearchTerm('')} className="hover:bg-blue-500/30 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {roleFilter && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400 text-xs">
                  Role: {roles.find(r => r.name === roleFilter)?.displayName || roleFilter}
                  <button onClick={() => setRoleFilter('')} className="hover:bg-purple-500/30 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {statusFilter && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                  statusFilter === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  Status: {statusFilter}
                  <button onClick={() => setStatusFilter('')} className={`rounded-full p-0.5 ${
                    statusFilter === 'active' ? 'hover:bg-green-500/30' : 'hover:bg-red-500/30'
                  }`}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {departmentFilter && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs">
                  Dept: {departmentFilter}
                  <button onClick={() => setDepartmentFilter('')} className="hover:bg-orange-500/30 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Expandable Filters Panel */}
        {showFiltersPanel && (
          <div className="border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Role Filter */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                  Role
                </label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">All Roles</option>
                  {roles.map(r => (
                    <option key={r.name} value={r.name}>{r.displayName} ({r.userCount})</option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* Department Filter */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                  Department
                </label>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">All Departments</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              {/* Quick Status Buttons */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                  Quick Filters
                </label>
                <div className="flex rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
                  <button
                    onClick={() => setStatusFilter('')}
                    className={`flex-1 px-3 py-2 text-sm transition-colors ${statusFilter === '' ? 'bg-blue-500 text-white' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setStatusFilter('active')}
                    className={`flex-1 px-3 py-2 text-sm transition-colors ${statusFilter === 'active' ? 'bg-green-500 text-white' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'}`}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => setStatusFilter('inactive')}
                    className={`flex-1 px-3 py-2 text-sm transition-colors ${statusFilter === 'inactive' ? 'bg-red-500 text-white' : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'}`}
                  >
                    Inactive
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Summary */}
        <div className="px-4 py-3 border-t border-[var(--ff-border-light)] text-sm text-[var(--ff-text-secondary)]">
          Showing <span className="font-medium text-[var(--ff-text-primary)]">{filteredUsers.length}</span> of {userStats.total} users
          {hasActiveFilters && ' (filtered)'}
        </div>
      </div>

      {/* Users table */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Department</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Active</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Last Login</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {filteredUsers.map((user) => {
              const isUpdating = updatingUserId === user.id;
              const isAdmin = user.role === 'super_admin' || user.role === 'admin';

              return (
                <tr key={user.id} className={`hover:bg-[var(--ff-bg-tertiary)] ${isUpdating ? 'opacity-60' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${
                        isAdmin ? 'bg-gradient-to-br from-orange-500 to-red-500' : 'bg-gradient-to-br from-blue-500 to-purple-500'
                      }`}>
                        {user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                          {user.fullName}
                          {isAdmin && <span title="Admin"><ShieldCheck className="w-4 h-4 text-orange-400" /></span>}
                        </div>
                        <div className="text-sm text-[var(--ff-text-secondary)]">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <select
                      value={user.role}
                      onChange={(e) => updateUserRole(user.id, e.target.value)}
                      disabled={isUpdating}
                      className={`text-sm px-3 py-2 border rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 ${
                        user.role === 'super_admin' ? 'border-orange-500/50' :
                        user.role === 'admin' ? 'border-blue-500/50' :
                        user.role === 'viewer' ? 'border-gray-500/50' :
                        'border-[var(--ff-border-light)]'
                      }`}
                    >
                      {roles.map(r => (
                        <option key={r.name} value={r.name}>{r.displayName}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                    {user.department || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <div className="flex items-center justify-center gap-2">
                      {isUpdating ? (
                        <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                      ) : (
                        <ToggleSwitch
                          checked={user.isActive}
                          onChange={() => toggleUserStatus(user.id, user.isActive)}
                          activeColor="green"
                          label={user.isActive ? 'Click to deactivate' : 'Click to activate'}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                    {user.lastLogin
                      ? new Date(user.lastLogin).toLocaleDateString()
                      : <span className="text-[var(--ff-text-tertiary)]">Never</span>
                    }
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Quick Full Access Button */}
                      {user.role !== 'super_admin' && (
                        <button
                          onClick={() => grantFullAccess(user.id)}
                          disabled={isUpdating}
                          className="text-xs px-2 py-1.5 rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 disabled:opacity-50"
                          title="Grant full access (super_admin)"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 inline mr-1" />
                          Full Access
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedUserForPermissions(user)}
                        disabled={isUpdating}
                        className="text-xs px-2 py-1.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                        title="Edit user permissions"
                      >
                        <Settings className="w-3.5 h-3.5 inline mr-1" />
                        Permissions
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg">No users found</p>
            {searchTerm && (
              <p className="text-sm mt-1">
                Try a different search term or{' '}
                <button onClick={() => setSearchTerm('')} className="text-blue-400 hover:underline">
                  clear the search
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Render a single role permission row in the grid
  const renderRolePermRow = (key: string, label: string, type: string, indent: number) => {
    const local = localRolePerms.get(key);
    const server = serverRolePerms.get(key);
    if (!local) return null;

    const isChanged = server && (
      local.view !== server.view || local.create !== server.create ||
      local.edit !== server.edit || local.delete !== server.delete
    );
    const isSA = selectedRole === 'super_admin';

    const renderCheck = (action: keyof ActionFlags) => {
      const checked = local[action];
      const changed = server && checked !== server[action];
      return (
        <button
          onClick={() => !isSA && toggleRolePermAction(key, action)}
          disabled={isSA || savingRoleBatch}
          className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
            checked ? 'bg-green-500 border-green-500' : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]'
          } ${changed ? 'ring-2 ring-yellow-400/50' : ''} ${
            isSA ? 'cursor-not-allowed opacity-60' : 'hover:opacity-80'
          }`}
          title={`${action}: ${checked ? 'Enabled' : 'Disabled'}${changed ? ' (unsaved)' : ''}`}
        >
          {checked && <Check className="w-3 h-3 text-white" />}
        </button>
      );
    };

    return (
      <div
        key={key}
        className={`grid grid-cols-6 gap-2 items-center px-4 py-2 border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] ${
          isChanged ? 'bg-yellow-500/5' : ''
        }`}
        style={{ paddingLeft: `${1 + indent * 1.5}rem` }}
      >
        <div className="col-span-2 min-w-0">
          <button
            onClick={() => !isSA && toggleRolePermAll(key)}
            className="font-medium text-sm text-[var(--ff-text-primary)] hover:underline truncate block"
            title="Toggle all actions"
          >
            {label}
          </button>
          <div className="text-xs text-[var(--ff-text-tertiary)] truncate">{key}</div>
        </div>
        <div className="flex justify-center">{renderCheck('view')}</div>
        <div className="flex justify-center">{renderCheck('create')}</div>
        <div className="flex justify-center">{renderCheck('edit')}</div>
        <div className="flex justify-center">{renderCheck('delete')}</div>
      </div>
    );
  };

  // Render roles tab
  const renderRolesTab = () => {
    const currentRole = roles.find(r => r.name === selectedRole);
    const isSuperAdmin = selectedRole === 'super_admin';
    const hasRoleChanges = roleChangeCount > 0;

    return (
      <div className="grid grid-cols-4 gap-6">
        {/* Role list */}
        <div className="col-span-1 space-y-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-[var(--ff-text-secondary)]">Roles</h4>
            <button
              onClick={() => {
                setNewRoleName('');
                setNewRoleDisplayName('');
                setNewRoleDescription('');
                setShowCreateRoleModal(true);
              }}
              className="p-1.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
              title="Create new role"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {roles.map((role) => (
            <div
              key={role.name}
              className={`group relative rounded-lg transition-colors ${
                selectedRole === role.name
                  ? 'bg-blue-500/20 border border-blue-500/50'
                  : 'bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              <button
                onClick={() => setSelectedRole(role.name)}
                className="w-full flex items-center justify-between px-4 py-3 text-left text-[var(--ff-text-primary)]"
              >
                <div className="flex items-center gap-2">
                  {role.isSystem && (
                    <span title="System role"><Lock className="w-3.5 h-3.5 text-[var(--ff-text-tertiary)]" /></span>
                  )}
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <div>
                    <div className="font-medium">{role.displayName}</div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">{role.userCount} users</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
              </button>

              {/* Action buttons on hover */}
              <div className="absolute right-10 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openCloneModal(role);
                  }}
                  className="p-1 rounded text-[var(--ff-text-tertiary)] hover:text-blue-400 hover:bg-blue-500/20"
                  title="Clone role"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {!role.isSystem && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRoleToDelete(role);
                    }}
                    className="p-1 rounded text-[var(--ff-text-tertiary)] hover:text-red-400 hover:bg-red-500/20"
                    title="Delete role"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Role permissions */}
        <div className="col-span-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg flex flex-col max-h-[70vh]">
          {currentRole ? (
            <>
              {/* Header with save/discard */}
              <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{currentRole.displayName}</h3>
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      {allFlatPermissions.length} total permissions
                      {isSuperAdmin && (
                        <span className="ml-2 text-yellow-400">(Super Admin - all access, not editable)</span>
                      )}
                    </p>
                  </div>
                  {!isSuperAdmin && (
                    <div className="flex items-center gap-3">
                      {hasRoleChanges && (
                        <span className="text-sm text-yellow-400">
                          {roleChangeCount} changed
                        </span>
                      )}
                      <button
                        onClick={discardRoleChanges}
                        disabled={!hasRoleChanges || savingRoleBatch}
                        className="flex items-center px-3 py-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg disabled:opacity-30"
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        Discard
                      </button>
                      <button
                        onClick={saveRoleChanges}
                        disabled={!hasRoleChanges || savingRoleBatch}
                        className="flex items-center px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingRoleBatch ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5 mr-1" />
                        )}
                        {savingRoleBatch ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <input
                    type="text"
                    placeholder="Search permissions..."
                    value={roleSearchTerm}
                    onChange={(e) => setRoleSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] text-sm"
                  />
                </div>
              </div>

              {/* Permissions grid */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-2">
                  {filteredRoleGroups.map((group) => {
                    const allGroupKeys = [group.moduleKey, ...group.children.map(c => c.key)];
                    const moduleHasChanges = allGroupKeys.some(key => {
                      const local = localRolePerms.get(key);
                      const server = serverRolePerms.get(key);
                      return local && server && (
                        local.view !== server.view || local.create !== server.create ||
                        local.edit !== server.edit || local.delete !== server.delete
                      );
                    });

                    return (
                      <div key={group.moduleKey} className={`border rounded-lg overflow-hidden ${
                        moduleHasChanges ? 'border-yellow-500/30' : 'border-[var(--ff-border-light)]'
                      }`}>
                        {/* Module header */}
                        <div className="flex items-center justify-between bg-[var(--ff-bg-tertiary)]">
                          <button
                            onClick={() => toggleRoleModuleExpand(group.moduleKey)}
                            className="flex-1 flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--ff-bg-secondary)] text-left"
                          >
                            {roleExpandedModules.has(group.moduleKey) ? (
                              <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                            )}
                            <span className="font-medium text-sm text-[var(--ff-text-primary)]">
                              {group.moduleLabel}
                            </span>
                            {moduleHasChanges && (
                              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Modified</span>
                            )}
                            <span className="text-xs text-[var(--ff-text-tertiary)]">
                              {group.children.length + 1} permissions
                            </span>
                          </button>
                          {!isSuperAdmin && (
                            <div className="flex items-center gap-1 pr-3">
                              <button
                                onClick={() => toggleRoleModule(group.moduleKey, true)}
                                disabled={savingRoleBatch}
                                className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50"
                                title="Enable all permissions for this module"
                              >All</button>
                              <button
                                onClick={() => toggleRoleModule(group.moduleKey, false)}
                                disabled={savingRoleBatch}
                                className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                                title="Disable all permissions for this module"
                              >None</button>
                            </div>
                          )}
                        </div>

                        {/* Permission rows */}
                        {roleExpandedModules.has(group.moduleKey) && (
                          <div className="bg-[var(--ff-bg-secondary)]">
                            {/* Column headers */}
                            <div className="grid grid-cols-6 gap-2 px-4 py-1.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase border-b border-[var(--ff-border-light)]">
                              <div className="col-span-2">Permission</div>
                              <div className="text-center">View</div>
                              <div className="text-center">Create</div>
                              <div className="text-center">Edit</div>
                              <div className="text-center">Delete</div>
                            </div>
                            {/* Module row */}
                            {renderRolePermRow(group.moduleKey, group.moduleLabel, 'module', 0)}
                            {/* Child rows */}
                            {group.children.map(child =>
                              renderRolePermRow(child.key, child.label, child.type, child.indent)
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredRoleGroups.length === 0 && (
                    <div className="text-center py-8 text-[var(--ff-text-secondary)]">
                      No permissions found matching your search
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-[var(--ff-text-secondary)]">
              Select a role to view permissions
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render permissions tab
  const renderPermissionsTab = () => (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center text-[var(--ff-text-primary)]">
        <Key className="w-5 h-5 mr-2" />
        Permission Hierarchy
      </h3>

      <div className="space-y-2">
        {permissionTree.map((module) => (
          <div key={module.key} className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <button
              onClick={() => toggleModule(module.key)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            >
              <div className="flex items-center">
                {expandedModules.has(module.key) ? (
                  <ChevronDown className="w-4 h-4 mr-2" />
                ) : (
                  <ChevronRight className="w-4 h-4 mr-2" />
                )}
                <span className="font-medium">{module.label}</span>
                <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                  {module.type}
                </span>
              </div>
              <span className="text-xs text-[var(--ff-text-tertiary)]">{module.key}</span>
            </button>

            {expandedModules.has(module.key) && module.children && (
              <div className="px-4 py-2 space-y-1 bg-[var(--ff-bg-secondary)]">
                {module.children.map((page) => (
                  <div key={page.key} className="pl-6 py-2 border-l-2 border-[var(--ff-border-light)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm text-[var(--ff-text-primary)]">{page.label}</span>
                        <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                          {page.type}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--ff-text-tertiary)]">{page.key}</span>
                    </div>
                    {page.route && (
                      <div className="text-xs text-[var(--ff-text-tertiary)] mt-1">{page.route}</div>
                    )}

                    {page.children && page.children.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {page.children.map((tab) => (
                          <div key={tab.key} className="pl-4 py-1 text-sm flex items-center justify-between">
                            <div>
                              <span className="text-[var(--ff-text-primary)]">{tab.label}</span>
                              <span className="ml-2 text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">
                                {tab.type}
                              </span>
                            </div>
                            <span className="text-xs text-[var(--ff-text-tertiary)]">{tab.key}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center text-[var(--ff-text-primary)]">
            <Shield className="w-5 h-5 mr-2" />
            Access Control
          </h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Manage users, roles, and permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={provisionUsersFromStaff}
            disabled={provisioning}
            className="flex items-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {provisioning ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            {provisioning ? 'Provisioning...' : 'Add Staff as Users'}
          </button>
          <button
            onClick={() => {
              fetchUsers();
              fetchRoles();
              fetchPermissionTree();
            }}
            className="flex items-center px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center p-4 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <div className="flex items-center p-4 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30">
          <Check className="w-5 h-5 mr-2" />
          {successMessage}
          <button onClick={() => setSuccessMessage(null)} className="ml-auto hover:text-green-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="border-b border-[var(--ff-border-light)]">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setSubTab('users')}
            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
              subTab === 'users'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Users ({users.length})</span>
          </button>
          <button
            onClick={() => setSubTab('roles')}
            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
              subTab === 'roles'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
            }`}
          >
            <UserCog className="w-4 h-4" />
            <span>Roles ({roles.length})</span>
          </button>
          <button
            onClick={() => setSubTab('permissions')}
            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
              subTab === 'permissions'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Permissions</span>
          </button>
        </nav>
      </div>

      {/* Tab content */}
      {subTab === 'users' && renderUsersTab()}
      {subTab === 'roles' && renderRolesTab()}
      {subTab === 'permissions' && renderPermissionsTab()}

      {/* User Permissions Modal */}
      {selectedUserForPermissions && (
        <UserPermissionsModal
          isOpen={true}
          onClose={() => setSelectedUserForPermissions(null)}
          user={{
            id: selectedUserForPermissions.id,
            email: selectedUserForPermissions.email,
            fullName: selectedUserForPermissions.fullName,
            role: selectedUserForPermissions.role,
            roleDisplayName: selectedUserForPermissions.roleDisplayName,
          }}
          onPermissionsUpdated={() => {
            fetchUsers();
            fetchRoles();
          }}
        />
      )}

      {/* Create Role Modal */}
      {showCreateRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Create New Role</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Role Name (internal)
                </label>
                <input
                  type="text"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
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
                  value={newRoleDisplayName}
                  onChange={(e) => setNewRoleDisplayName(e.target.value)}
                  placeholder="e.g., QA Reviewer"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  placeholder="Describe this role's purpose..."
                  rows={2}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateRoleModal(false)}
                className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={createRole}
                disabled={!newRoleName || !newRoleDisplayName || savingRole}
                className="flex items-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingRole && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone Role Modal */}
      {showCloneRoleModal && roleToClone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">Clone Role</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
              Cloning <span className="font-medium text-[var(--ff-text-primary)]">{roleToClone.displayName}</span> with {roleToClone.permissionCount} permissions
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  New Role Name (internal)
                </label>
                <input
                  type="text"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="e.g., qa_reviewer"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={newRoleDisplayName}
                  onChange={(e) => setNewRoleDisplayName(e.target.value)}
                  placeholder="e.g., QA Reviewer"
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  placeholder="Describe this role's purpose..."
                  rows={2}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCloneRoleModal(false);
                  setRoleToClone(null);
                }}
                className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={cloneRole}
                disabled={!newRoleName || !newRoleDisplayName || savingRole}
                className="flex items-center px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingRole && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Copy className="w-4 h-4 mr-2" />
                Clone Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Role Confirmation */}
      {roleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">Delete Role</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
              Are you sure you want to delete <span className="font-medium text-red-400">{roleToDelete.displayName}</span>?
              {roleToDelete.userCount > 0 && (
                <span className="block mt-2 text-yellow-400">
                  ⚠️ This role has {roleToDelete.userCount} user(s). You must reassign them first.
                </span>
              )}
            </p>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setRoleToDelete(null)}
                className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={deleteRole}
                disabled={roleToDelete.userCount > 0 || savingRole}
                className="flex items-center px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingRole && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
