/**
 * Access Control Tab - RBAC Admin UI
 * Manage users, roles, and permissions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Shield, Key, Search, ChevronRight, ChevronDown,
  Check, X, AlertCircle, Loader2, RefreshCw, UserCog, UserPlus
} from 'lucide-react';

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
  name: string;
  displayName: string;
  permissions: PermissionWithActions[];
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
  const [provisioning, setProvisioning] = useState(false);

  // Roles state
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  // Permissions state
  const [permissionTree, setPermissionTree] = useState<PermissionNode[]>([]);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.data.users);
      }
    } catch (err) {
      setError('Failed to fetch users');
    }
  }, [searchTerm, roleFilter, statusFilter]);

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
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchUsers();
      }
    } catch (err) {
      setError('Failed to update user status');
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

  // Render users tab
  const renderUsersTab = () => (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-secondary)]" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
        >
          <option value="">All Roles</option>
          {roles.map(r => (
            <option key={r.name} value={r.name}>{r.displayName}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Users table */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Department</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Last Login</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-[var(--ff-bg-tertiary)]">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="font-medium text-[var(--ff-text-primary)]">{user.fullName}</div>
                    <div className="text-sm text-[var(--ff-text-secondary)]">{user.email}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <select
                    value={user.role}
                    onChange={(e) => updateUserRole(user.id, e.target.value)}
                    className="text-sm px-2 py-1 border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
                  >
                    {roles.map(r => (
                      <option key={r.name} value={r.name}>{r.displayName}</option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                  {user.department || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.isActive
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                  {user.lastLogin
                    ? new Date(user.lastLogin).toLocaleDateString()
                    : 'Never'
                  }
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => toggleUserStatus(user.id, user.isActive)}
                    className={`text-sm px-3 py-1 rounded ${
                      user.isActive
                        ? 'text-red-400 hover:bg-red-500/20'
                        : 'text-green-400 hover:bg-green-500/20'
                    }`}
                  >
                    {user.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="text-center py-8 text-[var(--ff-text-secondary)]">
            No users found
          </div>
        )}
      </div>
    </div>
  );

  // Render roles tab
  const renderRolesTab = () => {
    const currentRole = roles.find(r => r.name === selectedRole);

    return (
      <div className="grid grid-cols-4 gap-6">
        {/* Role list */}
        <div className="col-span-1 space-y-2">
          <h4 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Roles</h4>
          {roles.map((role) => (
            <button
              key={role.name}
              onClick={() => setSelectedRole(role.name)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors ${
                selectedRole === role.name
                  ? 'bg-blue-500/20 border border-blue-500/50 text-[var(--ff-text-primary)]'
                  : 'bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
              }`}
            >
              <div>
                <div className="font-medium">{role.displayName}</div>
                <div className="text-xs text-[var(--ff-text-tertiary)]">{role.userCount} users</div>
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            </button>
          ))}
        </div>

        {/* Role permissions */}
        <div className="col-span-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
          {currentRole ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">{currentRole.displayName}</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{currentRole.permissions.length} permissions assigned</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-2 text-xs font-medium text-[var(--ff-text-secondary)] uppercase pb-2 border-b border-[var(--ff-border-light)]">
                  <div className="col-span-2">Permission</div>
                  <div className="text-center">View</div>
                  <div className="text-center">Create</div>
                  <div className="text-center">Edit</div>
                </div>

                {currentRole.permissions.slice(0, 20).map((perm) => (
                  <div key={perm.key} className="grid grid-cols-5 gap-2 items-center py-2 border-b border-[var(--ff-border-light)]">
                    <div className="col-span-2">
                      <div className="font-medium text-sm text-[var(--ff-text-primary)]">{perm.label}</div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">{perm.key}</div>
                    </div>
                    <div className="flex justify-center">
                      {perm.actions.view ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <X className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      )}
                    </div>
                    <div className="flex justify-center">
                      {perm.actions.create ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <X className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      )}
                    </div>
                    <div className="flex justify-center">
                      {perm.actions.edit ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <X className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                      )}
                    </div>
                  </div>
                ))}

                {currentRole.permissions.length > 20 && (
                  <div className="text-center text-sm text-[var(--ff-text-secondary)] py-2">
                    +{currentRole.permissions.length - 20} more permissions
                  </div>
                )}
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
    </div>
  );
}
