/**
 * Department Form Component
 * Create/Edit department form
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { X } from 'lucide-react';
import type { Department, CreateDepartmentRequest } from '@/types/staff/department.types';

interface StaffOption {
  id: string;
  name: string;
}

interface DepartmentFormProps {
  department?: Department | null;
  onSave: (data: CreateDepartmentRequest) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function DepartmentForm({
  department,
  onSave,
  onCancel,
  isSubmitting = false,
}: DepartmentFormProps) {
  const [name, setName] = useState(department?.name || '');
  const [code, setCode] = useState(department?.code || '');
  const [description, setDescription] = useState(department?.description || '');
  const [managerId, setManagerId] = useState(department?.managerId || '');
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Fetch staff for manager dropdown
    fetch('/api/staff?status=active&limit=100')
      .then((res) => res.json())
      .then((data) => {
        const staff = (data.data || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          name: (s.firstName && s.lastName
            ? `${s.firstName} ${s.lastName}`
            : s.name) as string,
        }));
        setStaffOptions(staff);
      })
      .catch(() => {
        // Ignore errors
      });
  }, []);

  // Auto-generate code from name
  useEffect(() => {
    if (!department && name && !code) {
      setCode(name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
    }
  }, [name, department, code]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Department name is required';
    }
    if (!code.trim()) {
      newErrors.code = 'Department code is required';
    } else if (!/^[a-z0-9_]+$/.test(code)) {
      newErrors.code = 'Code must be lowercase letters, numbers, and underscores only';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    await onSave({
      name: name.trim(),
      code: code.toLowerCase().trim(),
      description: description.trim() || undefined,
      managerId: managerId || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          {department ? 'Edit Department' : 'Add Department'}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Department Name *
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Field Operations"
          className={errors.name ? 'border-red-500' : ''}
        />
        {errors.name && (
          <p className="text-xs text-red-400 mt-1">{errors.name}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Code *
        </label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
          placeholder="e.g., field_operations"
          className={errors.code ? 'border-red-500' : ''}
        />
        {errors.code && (
          <p className="text-xs text-red-400 mt-1">{errors.code}</p>
        )}
        <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
          Unique identifier (auto-generated from name)
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of the department..."
          rows={3}
          className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
          Department Manager
        </label>
        <select
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">No manager assigned</option>
          {staffOptions.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? 'Saving...' : department ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
