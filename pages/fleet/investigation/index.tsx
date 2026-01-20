/**
 * Fleet GPS Investigation Page
 * Upload GPS files and view investigation history
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  FileSearch,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  FileSpreadsheet,
  Car,
  Calendar,
  TrendingUp,
  MapPin,
} from 'lucide-react';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';

interface FleetVehicle {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
}

interface Investigation {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  errorMessage: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalTrips: number | null;
  unauthorizedTrips: number | null;
  unauthorizedCost: number | null;
  createdAt: string;
  completedAt: string | null;
}

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-gray-100 text-gray-800', icon: Clock },
  processing: { label: 'Processing', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function FleetInvestigationPage() {
  const router = useRouter();
  const { vehicleId } = router.query;
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [vehiclesRes, investigationsRes] = await Promise.all([
          fetch('/api/fleet/vehicles?status=active'),
          fetch('/api/fleet/investigation'),
        ]);

        const vehiclesData = await vehiclesRes.json();
        const investigationsData = await investigationsRes.json();

        setVehicles(vehiclesData.data || []);
        setInvestigations(investigationsData.data || []);
        setLoading(false);
      } catch (err) {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Auto-select vehicle from URL query param
  useEffect(() => {
    if (vehicleId && typeof vehicleId === 'string' && vehicles.length > 0) {
      const vehicleExists = vehicles.some(v => v.id === vehicleId);
      if (vehicleExists && !selectedVehicle) {
        setSelectedVehicle(vehicleId);
      }
    }
  }, [vehicleId, vehicles, selectedVehicle]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!selectedVehicle) {
      setUploadError('Please select a vehicle first');
      return;
    }

    const file = acceptedFiles[0];
    if (!file) {
      setUploadError('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setUploadError('Invalid file type. Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('vehicleId', selectedVehicle);

      const res = await fetch('/api/fleet/investigation/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Upload failed');
      }

      setUploadSuccess(`Investigation completed! Found ${data.data.summary.totalTrips} trips, ${data.data.summary.unauthorizedTrips} unauthorized.`);

      // Refresh investigations list
      const investigationsRes = await fetch('/api/fleet/investigation');
      const investigationsData = await investigationsRes.json();
      setInvestigations(investigationsData.data || []);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  }, [selectedVehicle]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: uploading,
  });

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">GPS Investigation</h1>
          <p className="text-[var(--ff-text-secondary)]">
            Upload GPS tracking data for automated analysis
          </p>
        </div>

        {/* Upload Section */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
            New Investigation
          </h2>

          {/* Vehicle Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              Select Vehicle
            </label>
            <select
              value={selectedVehicle}
              onChange={(e) => setSelectedVehicle(e.target.value)}
              className="w-full md:w-64 px-4 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-gray-500"
            >
              <option value="">Choose a vehicle...</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration} - {v.make} {v.model}
                </option>
              ))}
            </select>
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${isDragActive ? 'border-[var(--ff-primary)] bg-[var(--ff-primary)]/5' : 'border-[var(--ff-border-light)]'}
              ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-[var(--ff-primary)]'}
            `}
          >
            <input {...getInputProps()} />
            <FileSpreadsheet className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
            {uploading ? (
              <p className="text-[var(--ff-text-secondary)]">Uploading and processing...</p>
            ) : isDragActive ? (
              <p className="text-[var(--ff-primary)]">Drop the file here</p>
            ) : (
              <>
                <p className="text-[var(--ff-text-primary)] font-medium">
                  Drag & drop GPS Excel file here
                </p>
                <p className="text-[var(--ff-text-secondary)] text-sm mt-1">
                  or click to select file (.xlsx, .xls)
                </p>
              </>
            )}
          </div>

          {/* Status Messages */}
          {uploadError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <p className="text-red-700">{uploadError}</p>
            </div>
          )}
          {uploadSuccess && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="text-green-700">{uploadSuccess}</p>
            </div>
          )}
        </div>

        {/* Investigation History */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)]">
          <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Recent Investigations
            </h2>
          </div>
          {loading ? (
            <div className="p-8">
              <div className="animate-pulse space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 bg-[var(--ff-bg-tertiary)] rounded"></div>
                ))}
              </div>
            </div>
          ) : investigations.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FileSearch className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">No investigations yet</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Upload a GPS file to start your first investigation
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--ff-border-light)]">
              {investigations.map((inv) => {
                const status = statusConfig[inv.status];
                const StatusIcon = status.icon;
                return (
                  <Link key={inv.id} href={`/fleet/investigation/${inv.id}`}>
                    <div className="px-6 py-4 hover:bg-[var(--ff-bg-tertiary)] cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <Car className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                          </div>
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">
                              {inv.vehicleRegistration}
                            </p>
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              {inv.fileName}
                            </p>
                            <div className="flex items-center gap-4 mt-1 text-xs text-[var(--ff-text-tertiary)]">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(inv.createdAt).toLocaleDateString()}
                              </span>
                              {inv.periodStart && inv.periodEnd && (
                                <span>
                                  {new Date(inv.periodStart).toLocaleDateString()} - {new Date(inv.periodEnd).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                            <StatusIcon className="w-3 h-3" />
                            {status.label}
                          </span>
                          {inv.status === 'completed' && (
                            <div className="mt-2 text-sm">
                              <span className="text-[var(--ff-text-secondary)]">
                                {inv.unauthorizedTrips}/{inv.totalTrips} unauthorized
                              </span>
                              {inv.unauthorizedCost && inv.unauthorizedCost > 0 && (
                                <span className="text-red-500 ml-2">
                                  R{parseFloat(String(inv.unauthorizedCost)).toLocaleString()}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
