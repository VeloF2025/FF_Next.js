import { Plus, Edit2, Trash2 } from 'lucide-react';
import { DepartmentConfig } from '@/types/staff-hierarchy.types';

interface DepartmentsTabProps {
  departments: DepartmentConfig[];
  onAdd: () => void;
  onEdit: (department: DepartmentConfig) => void;
  onDelete: (id: string) => void;
  onInitialize: () => void;
}

export function DepartmentsTab({ departments, onAdd, onEdit, onDelete, onInitialize }: DepartmentsTabProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Department Management</h2>
        <div className="space-x-2">
          {departments.length === 0 && (
            <button
              onClick={onInitialize}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Initialize Default Departments
            </button>
          )}
          <button
            onClick={onAdd}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Department
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {departments.map((dept) => (
          <DepartmentCard
            key={dept.id}
            department={dept}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

interface DepartmentCardProps {
  department: DepartmentConfig;
  onEdit: (department: DepartmentConfig) => void;
  onDelete: (id: string) => void;
}

function DepartmentCard({ department, onEdit, onDelete }: DepartmentCardProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-[var(--ff-text-primary)]">{department.name}</h3>
        <div className="flex space-x-1">
          <button
            onClick={() => onEdit(department)}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-blue-600"
            aria-label={`Edit ${department.name} department`}
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(department.id)}
            className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-600"
            aria-label={`Delete ${department.name} department`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="text-sm text-[var(--ff-text-secondary)] space-y-1">
        {department.headEmployeeName && (
          <p>Head: {department.headEmployeeName}</p>
        )}
        {department.parentDepartment && (
          <p>Parent: {department.parentDepartment}</p>
        )}
        <p>Employees: {department.employeeCount || 0}</p>
        <p className={`inline-block px-2 py-1 rounded text-xs ${
          department.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {department.isActive ? 'Active' : 'Inactive'}
        </p>
      </div>
    </div>
  );
}