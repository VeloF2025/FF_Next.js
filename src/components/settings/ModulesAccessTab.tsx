/**
 * Modules Access Tab
 * Shows all modules in an expandable tree with who has access in a grid view
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Loader2, Search,
  Eye, Plus, Pencil, Trash2, ShieldCheck, ShieldOff,
  Layers, FileText, LayoutGrid, Users
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────

interface ModuleNode {
  key: string;
  label: string;
  type: string;
  route: string | null;
  roleCount: number;
  children?: ModuleNode[];
}

interface RoleAccess {
  role: string;
  actions: { view: boolean; create: boolean; edit: boolean; delete: boolean };
}

interface UserAccess {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  effectiveActions: { view: boolean; create: boolean; edit: boolean; delete: boolean };
  hasOverride: boolean;
}

interface ModuleDetail {
  permissionKey: string;
  roleAccess: RoleAccess[];
  usersWithAccess: UserAccess[];
  usersWithoutAccess: UserAccess[];
  totalWithAccess: number;
  totalWithoutAccess: number;
}

// ─── Role badge colors ──────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-500/20 text-red-400 border-red-500/30',
  admin: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  manager: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  project_manager: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  site_supervisor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  technician: 'bg-green-500/20 text-green-400 border-green-500/30',
  storeman: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  contractor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  client: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const ROLE_DISPLAY: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  project_manager: 'Project Manager',
  site_supervisor: 'Site Supervisor',
  technician: 'Technician',
  storeman: 'Storeman',
  contractor: 'Contractor',
  client: 'Client',
  viewer: 'Viewer',
};

// ─── Action icon helper ─────────────────────────────────────

function ActionBadge({ action, enabled }: { action: string; enabled: boolean }) {
  const icons: Record<string, typeof Eye> = { view: Eye, create: Plus, edit: Pencil, delete: Trash2 };
  const labels: Record<string, string> = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' };
  const Icon = icons[action] || Eye;

  return (
    <span
      title={`${labels[action]}: ${enabled ? 'Yes' : 'No'}`}
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs ${
        enabled
          ? 'bg-green-500/20 text-green-400'
          : 'bg-gray-700/50 text-gray-600'
      }`}
    >
      <Icon className="w-3 h-3" />
    </span>
  );
}

// ─── Type icon helper ───────────────────────────────────────

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'module': return <Layers className="w-4 h-4 text-blue-400" />;
    case 'page': return <FileText className="w-4 h-4 text-purple-400" />;
    case 'tab': return <LayoutGrid className="w-4 h-4 text-cyan-400" />;
    default: return <FileText className="w-4 h-4 text-gray-400" />;
  }
}

// ─── Component ──────────────────────────────────────────────

export function ModulesAccessTab() {
  const [tree, setTree] = useState<ModuleNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNoAccess, setShowNoAccess] = useState(false);

  // Fetch module tree
  const fetchTree = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/permissions/module-access');
      const data = await res.json();
      if (data.success) {
        setTree(data.data.tree);
        // Auto-expand first module
        if (data.data.tree.length > 0) {
          setExpanded(new Set([data.data.tree[0].key]));
        }
      } else {
        setError(data.error?.message || 'Failed to load modules');
      }
    } catch {
      setError('Failed to load modules');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch detail for selected permission
  const fetchDetail = useCallback(async (key: string) => {
    try {
      setDetailLoading(true);
      const res = await fetch(`/api/admin/permissions/module-access?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (data.success) {
        setDetail(data.data);
      }
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  useEffect(() => {
    if (selectedKey) fetchDetail(selectedKey);
  }, [selectedKey, fetchDetail]);

  // Toggle expand
  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Filter tree by search
  const filterTree = (nodes: ModuleNode[], term: string): ModuleNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    return nodes
      .map(node => {
        const childMatches = node.children ? filterTree(node.children, term) : [];
        const selfMatch = node.label.toLowerCase().includes(lower) || node.key.toLowerCase().includes(lower);
        if (selfMatch || childMatches.length > 0) {
          return { ...node, children: selfMatch ? node.children : childMatches };
        }
        return null;
      })
      .filter(Boolean) as ModuleNode[];
  };

  const filteredTree = filterTree(tree, searchTerm);

  // Render tree node
  const renderNode = (node: ModuleNode, depth: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.key);
    const isSelected = selectedKey === node.key;

    return (
      <div key={node.key}>
        <button
          onClick={() => {
            setSelectedKey(node.key);
            if (hasChildren) toggleExpand(node.key);
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors ${
            isSelected
              ? 'bg-blue-500/10 border-l-2 border-blue-500 text-blue-400'
              : 'border-l-2 border-transparent text-[var(--ff-text-secondary)]'
          }`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {hasChildren ? (
            isExpanded
              ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--ff-text-tertiary)]" />
              : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--ff-text-tertiary)]" />
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <TypeIcon type={node.type} />
          <span className="truncate flex-1">{node.label}</span>
          {node.roleCount > 0 && (
            <span className="text-xs text-[var(--ff-text-tertiary)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded">
              {node.roleCount} {node.roleCount === 1 ? 'role' : 'roles'}
            </span>
          )}
        </button>
        {hasChildren && isExpanded && node.children!.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  // Selected permission label
  const findNode = (nodes: ModuleNode[], key: string): ModuleNode | null => {
    for (const n of nodes) {
      if (n.key === key) return n;
      if (n.children) {
        const found = findNode(n.children, key);
        if (found) return found;
      }
    }
    return null;
  };

  const selectedNode = selectedKey ? findNode(tree, selectedKey) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading modules...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-red-400">{error}</div>
    );
  }

  return (
    <div className="flex border border-[var(--ff-border-light)] rounded-lg overflow-hidden" style={{ height: 'calc(100vh - 360px)', minHeight: '500px' }}>
      {/* Left panel: Module tree */}
      <div className="w-80 shrink-0 border-r border-[var(--ff-border-light)] flex flex-col bg-[var(--ff-bg-secondary)]">
        {/* Search */}
        <div className="p-3 border-b border-[var(--ff-border-light)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search modules..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-md text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        {/* Tree */}
        <div className="flex-1 overflow-y-auto">
          {filteredTree.length === 0 ? (
            <div className="text-center py-8 text-[var(--ff-text-tertiary)] text-sm">No modules found</div>
          ) : (
            filteredTree.map(node => renderNode(node))
          )}
        </div>
      </div>

      {/* Right panel: Access detail */}
      <div className="flex-1 flex flex-col bg-[var(--ff-bg-primary)] overflow-hidden">
        {!selectedKey ? (
          <div className="flex-1 flex items-center justify-center text-[var(--ff-text-tertiary)]">
            <div className="text-center">
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a module to see who has access</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          </div>
        ) : detail ? (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
              <div className="flex items-center gap-3">
                <TypeIcon type={selectedNode?.type || 'module'} />
                <div>
                  <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">
                    {selectedNode?.label || selectedKey}
                  </h3>
                  <p className="text-xs text-[var(--ff-text-tertiary)] font-mono">{selectedKey}</p>
                </div>
                <div className="ml-auto flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5 text-green-400">
                    <ShieldCheck className="w-4 h-4" />
                    {detail.totalWithAccess} with access
                  </span>
                  <span className="flex items-center gap-1.5 text-[var(--ff-text-tertiary)]">
                    <ShieldOff className="w-4 h-4" />
                    {detail.totalWithoutAccess} without
                  </span>
                </div>
              </div>

              {/* Role summary */}
              {detail.roleAccess.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.roleAccess.map(ra => {
                    const hasView = ra.actions.view;
                    if (!hasView) return null;
                    return (
                      <span
                        key={ra.role}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium ${
                          ROLE_COLORS[ra.role] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        }`}
                      >
                        {ROLE_DISPLAY[ra.role] || ra.role}
                        <span className="flex gap-0.5 ml-1">
                          {ra.actions.view && <Eye className="w-3 h-3" />}
                          {ra.actions.create && <Plus className="w-3 h-3" />}
                          {ra.actions.edit && <Pencil className="w-3 h-3" />}
                          {ra.actions.delete && <Trash2 className="w-3 h-3" />}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Toggle: show no-access users */}
              <div className="mt-3">
                <button
                  onClick={() => setShowNoAccess(!showNoAccess)}
                  className="text-xs text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]"
                >
                  {showNoAccess ? 'Hide users without access' : `Show ${detail.totalWithoutAccess} users without access`}
                </button>
              </div>
            </div>

            {/* User grid */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--ff-bg-secondary)]">
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left px-6 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">User</th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider">Role</th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider w-8" title="View"><Eye className="w-3.5 h-3.5 mx-auto" /></th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider w-8" title="Create"><Plus className="w-3.5 h-3.5 mx-auto" /></th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider w-8" title="Edit"><Pencil className="w-3.5 h-3.5 mx-auto" /></th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider w-8" title="Delete"><Trash2 className="w-3.5 h-3.5 mx-auto" /></th>
                    <th className="text-center px-3 py-2.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wider w-16">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.usersWithAccess.map(user => (
                    <tr key={user.userId} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                          <div>
                            <div className="text-[var(--ff-text-primary)] font-medium">{user.fullName}</div>
                            <div className="text-xs text-[var(--ff-text-tertiary)]">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${
                          ROLE_COLORS[user.role] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        }`}>
                          {ROLE_DISPLAY[user.role] || user.role}
                        </span>
                      </td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="view" enabled={user.effectiveActions.view} /></td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="create" enabled={user.effectiveActions.create} /></td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="edit" enabled={user.effectiveActions.edit} /></td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="delete" enabled={user.effectiveActions.delete} /></td>
                      <td className="text-center px-3 py-2.5">
                        {user.hasOverride ? (
                          <span className="text-xs text-amber-400" title="User has a permission override">Override</span>
                        ) : (
                          <span className="text-xs text-[var(--ff-text-tertiary)]">Role</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {showNoAccess && detail.usersWithoutAccess.map(user => (
                    <tr key={user.userId} className="border-b border-[var(--ff-border-light)] opacity-40">
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                          <div>
                            <div className="text-[var(--ff-text-primary)]">{user.fullName}</div>
                            <div className="text-xs text-[var(--ff-text-tertiary)]">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${
                          ROLE_COLORS[user.role] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                        }`}>
                          {ROLE_DISPLAY[user.role] || user.role}
                        </span>
                      </td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="view" enabled={false} /></td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="create" enabled={false} /></td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="edit" enabled={false} /></td>
                      <td className="text-center px-3 py-2.5"><ActionBadge action="delete" enabled={false} /></td>
                      <td className="text-center px-3 py-2.5">
                        <span className="text-xs text-red-400">No access</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {detail.usersWithAccess.length === 0 && (
                <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
                  <ShieldOff className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No users have access to this module</p>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
