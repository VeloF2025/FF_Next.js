'use client';

import { useEffect, useState } from 'react';
import { Search, Filter, ChevronDown, Loader2, List, Columns } from 'lucide-react';
import { MancoActionItem, MancoActionItemStats } from '@/types/manco-action-items.types';
import { log } from '@/lib/logger';
import { MancoDetailPane } from '../components/MancoDetailPane';
import { MancoKanbanView } from '../components/MancoKanbanView';
import {
  isOverdue,
  daysUntilEta,
  formatDate,
  truncateText,
  getUniqueDepartments,
  getUniqueResponsiblePersons,
} from '../components/manco-grid-helpers';

type TabType = 'all' | 'pending' | 'in_progress' | 'completed' | 'overdue';
type ViewMode = 'list' | 'kanban';

export function MancoStrategicGrid() {
  const [items, setItems] = useState<MancoActionItem[]>([]);
  const [stats, setStats] = useState<MancoActionItemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<TabType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [responsibleFilter, setResponsibleFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<MancoActionItem | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [responsiblePersons, setResponsiblePersons] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('manco-view-mode') as ViewMode) || 'list';
    }
    return 'list';
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [itemsRes, statsRes] = await Promise.all([
        fetch('/api/manco-action-items'),
        fetch('/api/manco-action-items/stats'),
      ]);

      if (itemsRes.ok && statsRes.ok) {
        const itemsData = await itemsRes.json();
        const statsData = await statsRes.json();
        setItems(itemsData.data || itemsData);
        setStats(statsData.data || statsData);
        setDepartments(getUniqueDepartments(itemsData.data || itemsData));
        setResponsiblePersons(getUniqueResponsiblePersons(itemsData.data || itemsData));
      }
    } catch (error) {
      log.error('Error fetching manco data', { error });
    } finally {
      setLoading(false);
    }
  };

  const filterItems = (): MancoActionItem[] => {
    let filtered = [...items];

    if (departmentFilter) {
      filtered = filtered.filter((i) => i.department === departmentFilter);
    }
    if (responsibleFilter) {
      filtered = filtered.filter((i) => i.responsible_person === responsibleFilter);
    }
    if (searchTerm) {
      filtered = filtered.filter(
        (i) =>
          i.action_item.toLowerCase().includes(searchTerm.toLowerCase()) ||
          i.comment?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedTab === 'pending') {
      filtered = filtered.filter((i) => i.status === 'pending');
    } else if (selectedTab === 'in_progress') {
      filtered = filtered.filter((i) => i.status === 'in_progress');
    } else if (selectedTab === 'completed') {
      filtered = filtered.filter((i) => i.status === 'completed');
    } else if (selectedTab === 'overdue') {
      filtered = filtered.filter((i) => isOverdue(i));
    }

    return filtered.sort((a, b) => {
      if (a.completion_eta && b.completion_eta) {
        return new Date(a.completion_eta).getTime() - new Date(b.completion_eta).getTime();
      }
      return 0;
    });
  };

  const displayItems = filterItems();

  const handleRowClick = (item: MancoActionItem) => {
    setSelectedItem(item);
    setPaneOpen(true);
  };

  const handlePaneClose = () => {
    setPaneOpen(false);
    setTimeout(() => setSelectedItem(null), 300);
  };

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('manco-view-mode', mode);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-primary)]" />
      </div>
    );
  }

  return (
    <>
      <div className="p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">
            Manco Strategic Action Items
          </h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">
            Executive register from Manco meetings
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <p className="text-xs text-[var(--ff-text-secondary)] uppercase font-semibold">Total</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)] mt-1">
              {stats?.total || 0}
            </p>
          </div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <p className="text-xs text-[var(--ff-text-secondary)] uppercase font-semibold">Pending</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--ff-warning)' }}>
              {stats?.pending || 0}
            </p>
          </div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <p className="text-xs text-[var(--ff-text-secondary)] uppercase font-semibold">In Progress</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--ff-info)' }}>
              {stats?.in_progress || 0}
            </p>
          </div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <p className="text-xs text-[var(--ff-text-secondary)] uppercase font-semibold">Overdue</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--ff-danger)' }}>
              {stats?.overdue || 0}
            </p>
          </div>
        </div>

        {/* Tabs & View Toggle */}
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-2 border-b border-[var(--ff-border-light)]">
            {(['all', 'pending', 'in_progress', 'completed', 'overdue'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab)}
                className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
                  selectedTab === tab
                    ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                    : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                {tab.replace('_', ' ').toUpperCase()}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-1">
            <button
              onClick={() => handleViewChange('list')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'list'
                  ? 'bg-[var(--ff-primary)] text-white'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleViewChange('kanban')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-[var(--ff-primary)] text-white'
                  : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
              aria-label="Kanban view"
            >
              <Columns className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-4 mb-6 lg:flex-row">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-[var(--ff-text-secondary)]" />
            <input
              type="text"
              placeholder="Search action items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-secondary)]"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-3 w-4 h-4 text-[var(--ff-text-secondary)]" />
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] appearance-none cursor-pointer"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-3 w-4 h-4 pointer-events-none text-[var(--ff-text-secondary)]" />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-3 w-4 h-4 text-[var(--ff-text-secondary)]" />
            <select
              value={responsibleFilter}
              onChange={(e) => setResponsibleFilter(e.target.value)}
              className="pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] appearance-none cursor-pointer"
            >
              <option value="">All Responsible</option>
              {responsiblePersons.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-3 w-4 h-4 pointer-events-none text-[var(--ff-text-secondary)]" />
          </div>
        </div>

        {/* Render based on viewMode */}
        {viewMode === 'list' ? (
          <>
            {displayItems.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[var(--ff-text-secondary)]">No action items found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">Action Item</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">Department</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">Responsible</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">Logged</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">ETA</th>
                      <th className="px-4 py-3 text-center font-semibold text-[var(--ff-text-secondary)]">FF Dev</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">FF Module</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--ff-text-secondary)]">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayItems.map((item) => {
                      const overdue = isOverdue(item);
                      const daysLeft = daysUntilEta(item);
                      return (
                        <tr
                          key={item.id}
                          onClick={() => handleRowClick(item)}
                          className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3">
                            <span
                              className="px-2 py-1 rounded text-xs font-medium text-white"
                              style={{
                                backgroundColor: overdue
                                  ? 'var(--ff-danger)'
                                  : item.status === 'pending'
                                  ? 'var(--ff-warning)'
                                  : item.status === 'in_progress'
                                  ? 'var(--ff-info)'
                                  : item.status === 'completed'
                                  ? 'var(--ff-success)'
                                  : 'var(--ff-text-secondary)',
                              }}
                            >
                              {overdue ? 'OVERDUE' : item.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-[var(--ff-text-primary)]">
                            {item.action_item}
                          </td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]">{item.department || '—'}</td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                            {item.responsible_person || '—'}
                          </td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                            {formatDate(item.logged_date)}
                          </td>
                          <td
                            className="px-4 py-3"
                            style={{
                              color: overdue
                                ? 'var(--ff-danger)'
                                : daysLeft !== null && daysLeft <= 7
                                ? 'var(--ff-warning)'
                                : 'var(--ff-text-secondary)',
                            }}
                          >
                            {formatDate(item.completion_eta)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.fibreflow_dev ? '✓' : '—'}
                          </td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                            {item.fibreflow_module || '—'}
                          </td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]" title={item.comment}>
                            {truncateText(item.comment, 40)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <MancoKanbanView items={displayItems} onItemClick={handleRowClick} />
        )}
      </div>

      <MancoDetailPane
        item={selectedItem}
        isOpen={paneOpen}
        onClose={handlePaneClose}
        onUpdated={() => {
          fetchData();
          handlePaneClose();
        }}
      />
    </>
  );
}
