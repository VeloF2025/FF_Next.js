/**
 * Create New Pipeline Project Page
 * /projects/pipeline/new - Form to create a new pipeline project
 */

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  ArrowLeft,
  FolderKanban,
  Save,
  Loader2,
  Building2,
  MapPin,
  User,
  DollarSign,
  AlertCircle,
} from 'lucide-react';

interface Client {
  id: string;
  name: string;
}

interface Staff {
  id: string;
  first_name: string;
  last_name: string;
}

const NewPipelineProjectPage: NextPage = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  const [formData, setFormData] = useState({
    project_name: '',
    project_code: '',
    client_id: '',
    project_manager_id: '',
    province: '',
    municipality: '',
    estimated_value: '',
    notes: '',
  });

  useEffect(() => {
    loadDropdownData();
  }, []);

  const loadDropdownData = async () => {
    try {
      const clientsRes = await fetch('/api/clients?limit=500');
      const clientsData = await clientsRes.json();
      if (clientsData.success) {
        setClients(clientsData.data.clients || []);
      }

      const staffRes = await fetch('/api/staff?limit=500');
      const staffData = await staffRes.json();
      if (staffData.success) {
        setStaff(staffData.data.staff || []);
      }
    } catch (err) {
      // Error handled silently
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!formData.project_name.trim()) {
        throw new Error('Project name is required');
      }

      const response = await fetch('/api/pipeline/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          estimated_value: formData.estimated_value
            ? parseFloat(formData.estimated_value)
            : null,
          project_manager_id: formData.project_manager_id || null,
          client_id: formData.client_id || null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to create project');
      }

      router.push(`/projects/pipeline/${data.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Link
              href="/projects/pipeline"
              aria-label="Back to pipeline projects"
              className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
                <FolderKanban className="w-7 h-7 text-[var(--ff-accent)]" />
                New Pipeline Project
              </h1>
              <p className="text-[var(--ff-text-secondary)] mt-1">
                Create a new project to track through the approval pipeline
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" aria-live="polite" className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />
              <p className="text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Project Information */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Project Information
              </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="project_name" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Project Name <span className="text-red-500" aria-hidden="true">*</span>
                  </label>
                  <input
                    type="text"
                    id="project_name"
                    name="project_name"
                    value={formData.project_name}
                    onChange={handleChange}
                    required
                    aria-required="true"
                    placeholder="Enter project name"
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  />
                </div>

                <div>
                  <label htmlFor="project_code" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Project Code
                  </label>
                  <input
                    type="text"
                    id="project_code"
                    name="project_code"
                    value={formData.project_code}
                    onChange={handleChange}
                    placeholder="e.g., PL-00123 (auto-generated if blank)"
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  />
                </div>

                <div>
                  <label htmlFor="estimated_value" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    <DollarSign className="w-4 h-4 inline mr-1" aria-hidden="true" />
                    Estimated Value (ZAR)
                  </label>
                  <input
                    type="number"
                    id="estimated_value"
                    name="estimated_value"
                    value={formData.estimated_value}
                    onChange={handleChange}
                    placeholder="0"
                    min="0"
                    step="1000"
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Client & Team */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Client & Team
              </h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="client_id" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    <Building2 className="w-4 h-4 inline mr-1" aria-hidden="true" />
                    Client
                  </label>
                  <select
                    id="client_id"
                    name="client_id"
                    value={formData.client_id}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  >
                    <option value="">Select client...</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="project_manager_id" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    <User className="w-4 h-4 inline mr-1" aria-hidden="true" />
                    Project Manager
                  </label>
                  <select
                    id="project_manager_id"
                    name="project_manager_id"
                    value={formData.project_manager_id}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  >
                    <option value="">Select project manager...</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.first_name} {s.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                <MapPin className="w-5 h-5 inline mr-1" aria-hidden="true" />
                Location
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="province" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Province
                  </label>
                  <select
                    id="province"
                    name="province"
                    value={formData.province}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  >
                    <option value="">Select province...</option>
                    <option value="Eastern Cape">Eastern Cape</option>
                    <option value="Free State">Free State</option>
                    <option value="Gauteng">Gauteng</option>
                    <option value="KwaZulu-Natal">KwaZulu-Natal</option>
                    <option value="Limpopo">Limpopo</option>
                    <option value="Mpumalanga">Mpumalanga</option>
                    <option value="Northern Cape">Northern Cape</option>
                    <option value="North West">North West</option>
                    <option value="Western Cape">Western Cape</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="municipality" className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Municipality
                  </label>
                  <input
                    type="text"
                    id="municipality"
                    name="municipality"
                    value={formData.municipality}
                    onChange={handleChange}
                    placeholder="Enter municipality"
                    className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
              <label htmlFor="notes" className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4 block">Notes</label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="Add any additional notes about this project..."
                className="w-full px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent resize-none"
              />
            </div>

            {/* Submit Button */}
            <div className="flex items-center justify-end gap-4">
              <Link
                href="/projects/pipeline"
                className="px-6 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Create Project
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
};

export default NewPipelineProjectPage;
