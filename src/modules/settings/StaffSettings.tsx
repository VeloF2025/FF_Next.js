import { useState } from 'react';
import { Users, Building, GitBranch } from 'lucide-react';
import { useStaffSettings } from './hooks/useStaffSettings';
import { PositionsTab, DepartmentsTab, HierarchyTab } from './components';

export function StaffSettings() {
  const [activeTab, setActiveTab] = useState<'positions' | 'departments' | 'hierarchy'>('positions');
  const {
    positions,
    departments,
    setShowAddModal,
    setEditingItem,
    initializePositions,
    deletePosition,
    initializeDepartments,
    deleteDepartment
  } = useStaffSettings();

  return (
    <div className="p-6 bg-[var(--ff-bg-tertiary)] min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Staff Organization Settings</h1>
          <p className="text-[var(--ff-text-secondary)] mt-2">Manage positions, departments, and reporting structure</p>
        </div>

        {/* Tabs */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow">
          <div className="border-b border-[var(--ff-border-light)]">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('positions')}
                className={`px-6 py-3 text-sm font-medium ${
                  activeTab === 'positions'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                <Users className="w-4 h-4 inline-block mr-2" />
                Positions
              </button>
              <button
                onClick={() => setActiveTab('departments')}
                className={`px-6 py-3 text-sm font-medium ${
                  activeTab === 'departments'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                <Building className="w-4 h-4 inline-block mr-2" />
                Departments
              </button>
              <button
                onClick={() => setActiveTab('hierarchy')}
                className={`px-6 py-3 text-sm font-medium ${
                  activeTab === 'hierarchy'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                <GitBranch className="w-4 h-4 inline-block mr-2" />
                Reporting Hierarchy
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'positions' && (
              <PositionsTab
                positions={positions}
                onAdd={() => setShowAddModal(true)}
                onEdit={setEditingItem}
                onDelete={deletePosition}
                onInitialize={initializePositions}
              />
            )}

            {activeTab === 'departments' && (
              <DepartmentsTab
                departments={departments}
                onAdd={() => setShowAddModal(true)}
                onEdit={setEditingItem}
                onDelete={deleteDepartment}
                onInitialize={initializeDepartments}
              />
            )}

            {activeTab === 'hierarchy' && (
              <HierarchyTab />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}