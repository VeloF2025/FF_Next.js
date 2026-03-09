/**
 * Project Edit Form Component
 * Full-featured form for editing project details
 */

import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Save,
  X,
  Loader2,
  Calendar,
  MapPin,
  DollarSign,
  User,
  Building,
  FileText,
  AlertCircle
} from 'lucide-react';
import { useActiveClients } from '@/hooks/useClients';
import { useProjectManagers } from '@/hooks/useStaff';
import { notificationService } from '@/services/core/NotificationService';

interface ProjectFormData {
  id?: string;
  name: string;
  description?: string;
  clientId: string;
  projectManagerId?: string;
  status: string;
  priority: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  location?: {
    province?: string;
    city?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface ProjectFormProps {
  project?: any;
  onSubmit: (data: ProjectFormData) => void;
  onCancel: () => void;
}

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
];

/**
 * Convert ISO date string or Date to YYYY-MM-DD format for HTML date input
 */
const formatDateForInput = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

export const ProjectForm: React.FC<ProjectFormProps> = ({ project, onSubmit, onCancel }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: clients = [], isLoading: isClientsLoading } = useActiveClients();
  const { data: projectManagers = [], isLoading: isManagersLoading } = useProjectManagers();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
    reset
  } = useForm<ProjectFormData>({
    defaultValues: {
      name: '',
      description: '',
      clientId: '',
      projectManagerId: '',
      status: 'planning',
      priority: 'medium',
      startDate: '',
      endDate: '',
      budget: 0,
      location: {
        province: '',
        city: '',
        address: '',
      },
    },
  });

  // Populate form with existing project data
  useEffect(() => {
    if (project) {
      // Parse location: DB stores as string "City, Province", form needs object
      // Handle corrupted data where JSON object was saved as string (e.g. '{"province":""}')
      let locationObj = { province: '', city: '', address: '' };
      if (project.location && typeof project.location === 'string') {
        const loc = project.location.trim();
        if (loc.startsWith('{')) {
          // Corrupted JSON string — ignore it
          locationObj = { province: '', city: '', address: '' };
        } else {
          const parts = loc.split(',').map((s: string) => s.trim());
          locationObj = {
            city: parts[0] || '',
            province: parts[1] || '',
            address: '',
          };
        }
      } else if (project.location && typeof project.location === 'object') {
        locationObj = project.location;
      }

      const formData: ProjectFormData = {
        name: project.name || project.project_name || '',
        description: project.description || '',
        clientId: project.clientId || project.client_id || '',
        projectManagerId: project.projectManager || project.project_manager || '',
        status: (project.status || 'planning').toLowerCase(),
        priority: (project.priority || 'medium').toLowerCase(),
        // Convert ISO dates to YYYY-MM-DD format for HTML date inputs
        startDate: formatDateForInput(project.startDate || project.start_date),
        endDate: formatDateForInput(project.endDate || project.end_date),
        budget: Number(project.budget) || 0,
        location: locationObj,
      };
      reset(formData);
    }
  }, [project, reset]);

  const onFormSubmit = async (data: ProjectFormData) => {
    setIsSubmitting(true);
    try {
      await onSubmit(data);
      notificationService.success('Project updated successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update project';
      notificationService.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            {project ? 'Edit Project' : 'Create Project'}
          </h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Update project information and settings
          </p>
        </div>

        <form onSubmit={handleSubmit(onFormSubmit)} className="p-6 space-y-6">
          {/* Basic Information */}
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              Basic Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Project Name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  {...register('name', { required: 'Project name is required' })}
                  className={`w-full px-3 py-2 border rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.name ? 'border-red-500' : 'border-[var(--ff-border-light)]'
                  }`}
                  placeholder="Enter project name"
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* Client */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  <Building className="w-4 h-4 inline mr-1" />
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  {...register('clientId', { required: 'Client is required' })}
                  disabled={isClientsLoading}
                  className={`w-full px-3 py-2 border rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.clientId ? 'border-red-500' : 'border-[var(--ff-border-light)]'
                  }`}
                >
                  <option value="">Select client...</option>
                  {clients.map((client: any) => (
                    <option key={client.id} value={client.id}>
                      {client.company_name || client.companyName}
                    </option>
                  ))}
                </select>
                {errors.clientId && (
                  <p className="mt-1 text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.clientId.message}
                  </p>
                )}
              </div>

              {/* Project Manager */}
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  <User className="w-4 h-4 inline mr-1" />
                  Project Manager
                </label>
                <select
                  {...register('projectManagerId')}
                  disabled={isManagersLoading}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select manager...</option>
                  {projectManagers.map((pm: any) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Description
                </label>
                <textarea
                  {...register('description')}
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Project description..."
                />
              </div>
            </div>
          </section>

          {/* Status & Priority */}
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">
              Status & Priority
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Status
                </label>
                <select
                  {...register('status')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Priority
                </label>
                <select
                  {...register('priority')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Timeline & Budget */}
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              Timeline & Budget
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  {...register('startDate')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  {...register('endDate')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  <DollarSign className="w-4 h-4 inline mr-1" />
                  Budget (ZAR)
                </label>
                <Controller
                  name="budget"
                  control={control}
                  render={({ field }) => (
                    <input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                  )}
                />
              </div>
            </div>
          </section>

          {/* Location */}
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-500" />
              Location
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Province
                </label>
                <select
                  {...register('location.province')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select province...</option>
                  {PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  City
                </label>
                <input
                  type="text"
                  {...register('location.city')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="City name"
                />
              </div>

              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                  Address
                </label>
                <input
                  type="text"
                  {...register('location.address')}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Street address"
                />
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isDirty}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectForm;
