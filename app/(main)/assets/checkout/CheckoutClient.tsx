'use client';

/**
 * Checkout Client Component
 * Handles asset checkout form with staff/project integration
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowRight, Loader2, Package, User, Briefcase, Truck, ScanLine } from 'lucide-react';
import type { Asset } from '@/modules/assets/types';

// Dynamic import for barcode scanner (client-side only)
const BarcodeScannerModal = dynamic(
  () => import('@/modules/barcode-scanner/components/BarcodeScannerModal').then(mod => mod.default),
  { ssr: false, loading: () => null }
);

interface StaffMember {
  id: string;
  name: string;
  full_name: string;
  email: string;
  department: string;
  position: string;
}

interface Project {
  id: string;
  name: string;
  project_code: string;
  client_name?: string;
  status: string;
}

interface CheckoutClientProps {
  assets: Asset[];
  preselectedAssetId?: string;
  staffMembers: StaffMember[];
  projects: Project[];
}

type AssigneeType = 'staff' | 'project' | 'vehicle';

export function CheckoutClient({ assets, preselectedAssetId, staffMembers, projects }: CheckoutClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [formData, setFormData] = useState({
    assetId: preselectedAssetId || '',
    assigneeType: 'staff' as AssigneeType,
    assigneeId: '',
    assigneeName: '',
    projectId: '',
    vehicleReg: '',
    expectedReturnDate: '',
    notes: '',
  });

  // Get selected staff/project details
  const selectedStaff = staffMembers.find((s) => s.id === formData.assigneeId);
  const selectedProject = projects.find((p) => p.id === formData.projectId);

  const selectedAsset = assets.find((a) => a.id === formData.assetId);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  // Handle asset found from barcode scanner
  function handleAssetScanned(asset: Asset) {
    if (asset.status !== 'available') {
      setError(`Asset "${asset.name}" is currently ${asset.status} and cannot be checked out.`);
      return;
    }
    setFormData((prev) => ({ ...prev, assetId: asset.id }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let toId: string;
      let toName: string;

      if (formData.assigneeType === 'staff') {
        if (!selectedStaff) {
          throw new Error('Please select a staff member');
        }
        toId = selectedStaff.id;
        toName = selectedStaff.full_name || selectedStaff.name;
      } else if (formData.assigneeType === 'project') {
        if (!selectedProject) {
          throw new Error('Please select a project');
        }
        toId = selectedProject.id;
        toName = selectedProject.name;
      } else {
        // Vehicle
        if (!formData.vehicleReg) {
          throw new Error('Please enter vehicle registration');
        }
        toId = crypto.randomUUID();
        toName = formData.vehicleReg;
      }

      const payload: Record<string, any> = {
        toType: formData.assigneeType,
        toId,
        toName,
      };

      // Link project if assigning to staff and project selected
      if (formData.assigneeType === 'staff' && formData.projectId) {
        payload.projectId = formData.projectId;
      }
      if (formData.expectedReturnDate) payload.expectedReturnDate = formData.expectedReturnDate;
      if (formData.notes) payload.checkoutNotes = formData.notes;
      if (selectedAsset?.condition) payload.conditionAtCheckout = selectedAsset.condition;

      const response = await fetch(`/api/assets/${formData.assetId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check out asset');
      }

      router.push(`/inventory/${formData.assetId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const assigneeTypeIcons = {
    staff: User,
    project: Briefcase,
    vehicle: Truck,
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 space-y-6">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Asset Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Select Asset *
        </label>
        <div className="flex gap-2">
          <select
            name="assetId"
            value={formData.assetId}
            onChange={handleChange}
            required
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Choose an asset...</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.assetNumber} - {asset.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors flex items-center gap-2"
            title="Scan barcode"
          >
            <ScanLine className="h-5 w-5" />
            <span className="hidden sm:inline">Scan</span>
          </button>
        </div>
      </div>

      {/* Selected Asset Info */}
      {selectedAsset && (
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-start space-x-4">
          <div className="h-12 w-12 bg-white dark:bg-gray-600 rounded-lg flex items-center justify-center">
            <Package className="h-6 w-6 text-gray-400 dark:text-gray-500" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">{selectedAsset.name}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedAsset.manufacturer} {selectedAsset.model}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1">
              {selectedAsset.assetNumber}
              {selectedAsset.serialNumber && ` | S/N: ${selectedAsset.serialNumber}`}
            </p>
          </div>
        </div>
      )}

      {/* Assignee Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Assign To *
        </label>
        <div className="grid grid-cols-3 gap-4">
          {(['staff', 'project', 'vehicle'] as AssigneeType[]).map((type) => {
            const Icon = assigneeTypeIcons[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, assigneeType: type }))}
                className={`p-4 border rounded-lg flex flex-col items-center space-y-2 transition-colors ${
                  formData.assigneeType === type
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium capitalize">{type}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Staff Selection */}
      {formData.assigneeType === 'staff' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Staff Member *
          </label>
          {staffMembers.length === 0 ? (
            <p className="text-sm text-amber-600 dark:text-amber-400 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              No active staff members found. Please add staff members first.
            </p>
          ) : (
            <>
              <select
                name="assigneeId"
                value={formData.assigneeId}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select staff member...</option>
                {staffMembers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.full_name || staff.name} - {staff.department}
                  </option>
                ))}
              </select>
              {selectedStaff && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {selectedStaff.position} • {selectedStaff.email}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Project Selection - for staff assignments or direct project assignment */}
      {(formData.assigneeType === 'staff' || formData.assigneeType === 'project') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {formData.assigneeType === 'project' ? 'Project *' : 'Link to Project (optional)'}
          </label>
          {formData.assigneeType === 'project' && projects.length === 0 ? (
            <p className="text-sm text-amber-600 dark:text-amber-400 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
              No active projects found. Please create a project first.
            </p>
          ) : (
            <>
              <select
                name="projectId"
                value={formData.projectId}
                onChange={handleChange}
                required={formData.assigneeType === 'project'}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">
                  {formData.assigneeType === 'project' ? 'Select project...' : 'No project link'}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_code} - {project.name}
                    {project.client_name && ` (${project.client_name})`}
                  </option>
                ))}
              </select>
              {selectedProject && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Status: {selectedProject.status}
                  {selectedProject.client_name && ` • Client: ${selectedProject.client_name}`}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Vehicle Registration */}
      {formData.assigneeType === 'vehicle' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Vehicle Registration *
          </label>
          <input
            type="text"
            name="vehicleReg"
            value={formData.vehicleReg}
            onChange={handleChange}
            required
            placeholder="e.g., CA 123-456"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Expected Return Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Expected Return Date
        </label>
        <input
          type="date"
          name="expectedReturnDate"
          value={formData.expectedReturnDate}
          onChange={handleChange}
          min={new Date().toISOString().split('T')[0]}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Checkout Notes
        </label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          rows={3}
          placeholder="Any relevant notes for this checkout..."
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Submit */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 flex justify-end space-x-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={
            loading ||
            !formData.assetId ||
            (formData.assigneeType === 'staff' && !formData.assigneeId) ||
            (formData.assigneeType === 'project' && !formData.projectId) ||
            (formData.assigneeType === 'vehicle' && !formData.vehicleReg)
          }
          className="inline-flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <ArrowRight className="h-4 w-4 mr-2" />
              Check Out Asset
            </>
          )}
        </button>
      </div>

      {/* Barcode Scanner Modal - only render when open */}
      {scannerOpen && (
        <BarcodeScannerModal
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onAssetFound={handleAssetScanned}
          title="Scan Asset to Check Out"
          filterByStatus={['available']}
        />
      )}
    </form>
  );
}
