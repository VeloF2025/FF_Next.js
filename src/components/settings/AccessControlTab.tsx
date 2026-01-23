/**
 * Access Control Tab - RBAC Admin UI
 * Manage users, roles, and permissions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Shield, Key, Search, ChevronRight, ChevronDown,
  Check, X, AlertCircle, Loader2, RefreshCw, UserCog
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

  // Users state
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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

  // Render users tab
  const renderUsersTab = () => (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
          </div>
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
        >
          <option value="">All Roles</option>
          {roles.map(r => (
            <option key={r.name} value={r.name}>{r.displayName}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">{user.fullName}</div>
                    <div className="text-sm text-gray-500">{user.email}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <select
                    value={user.role}
                    onChange={(e) => updateUserRole(user.id, e.target.value)}
                    className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  >
                    {roles.map(r => (
                      <option key={r.name} value={r.name}>{r.displayName}</option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {user.department || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.isActive
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
                        ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                        : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
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
          <div className="text-center py-8 text-gray-500">
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
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Roles</h4>
          {roles.map((role) => (
            <button
              key={role.name}
              onClick={() => setSelectedRole(role.name)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors ${
                selectedRole === role.name
                  ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <div>
                <div className="font-medium">{role.displayName}</div>
                <div className="text-xs text-gray-500">{role.userCount} users</div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>
          ))}
        </div>

        {/* Role permissions */}
        <div className="col-span-3 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          {currentRole ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold">{currentRole.displayName}</h3>
                  <p className="text-sm text-gray-500">{currentRole.permissions.length} permissions assigned</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-2 text-xs font-medium text-gray-500 uppercase pb-2 border-b">
                  <div className="col-span-2">Permission</div>
                  <div className="text-center">View</div>
                  <div className="text-center">Create</div>
                  <div className="text-center">Edit</div>
                </div>

                {currentRole.permissions.slice(0, 20).map((perm) => (
                  <div key={perm.key} className="grid grid-cols-5 gap-2 items-center py-2 border-b border-gray-100 dark:border-gray-700">
                    <div className="col-span-2">
                      <div className="font-medium text-sm">{perm.label}</div>
                      <div className="text-xs text-gray-500">{perm.key}</div>
                    </div>
                    <div className="flex justify-center">
                      {perm.actions.view ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <X className="w-4 h-4 text-gray-300" />
                      )}
                    </div>
                    <div className="flex justify-center">
                      {perm.actions.create ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <X className="w-4 h-4 text-gray-300" />
                      )}
                    </div>
                    <div className="flex justify-center">
                      {perm.actions.edit ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <X className="w-4 h-4 text-gray-300" />
                      )}
                    </div>
                  </div>
                ))}

                {currentRole.permissions.length > 20 && (
                  <div className="text-center text-sm text-gray-500 py-2">
                    +{currentRole.permissions.length - 20} more permissions
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              Select a role to view permissions
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render permissions tab
  const renderPermissionsTab = () => (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        <Key className="w-5 h-5 mr-2" />
        Permission Hierarchy
      </h3>

      <div className="space-y-2">
        {permissionTree.map((module) => (
          <div key={module.key} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleModule(module.key)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <div className="flex items-center">
                {expandedModules.has(module.key) ? (
                  <ChevronDown className="w-4 h-4 mr-2" />
                ) : (
                  <ChevronRight className="w-4 h-4 mr-2" />
                )}
                <span className="font-medium">{module.label}</span>
                <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                  {module.type}
                </span>
              </div>
              <span className="text-xs text-gray-500">{module.key}</span>
            </button>

            {expandedModules.has(module.key) && module.children && (
              <div className="px-4 py-2 space-y-1">
                {module.children.map((page) => (
                  <div key={page.key} className="pl-6 py-2 border-l-2 border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{page.label}</span>
                        <span className="ml-2 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
                          {page.type}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">{page.key}</span>
                    </div>
                    {page.route && (
                      <div className="text-xs text-gray-400 mt-1">{page.route}</div>
                    )}

                    {page.children && page.children.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {page.children.map((tab) => (
                          <div key={tab.key} className="pl-4 py-1 text-sm flex items-center justify-between">
                            <div>
                              <span>{tab.label}</span>
                              <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded">
                                {tab.type}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500">{tab.key}</span>
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
          <h3 className="text-lg font-semibold flex items-center">
            <Shield className="w-5 h-5 mr-2" />
            Access Control
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Manage users, roles, and permissions
          </p>
        </div>
        <button
          onClick={() => {
            fetchUsers();
            fetchRoles();
            fetchPermissionTree();
          }}
          className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <RefreshCw className="w-4 h-4 mr-1" />
          Refresh
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setSubTab('users')}
            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
              subTab === 'users'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Users ({users.length})</span>
          </button>
          <button
            onClick={() => setSubTab('roles')}
            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
              subTab === 'roles'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <UserCog className="w-4 h-4" />
            <span>Roles ({roles.length})</span>
          </button>
          <button
            onClick={() => setSubTab('permissions')}
            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
              subTab === 'permissions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
