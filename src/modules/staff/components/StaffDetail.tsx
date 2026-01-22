'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft,
  Edit,
  FileText,
  FolderKanban,
  User,
  Briefcase,
  Shield,
  Car,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';
import { useStaffMember, useDeleteStaff } from '@/hooks/useStaff';
import { log } from '@/lib/logger';
import { notificationService } from '@/services/core/NotificationService';
import { StaffDocumentList } from '@/components/staff/StaffDocumentList';
import { StaffProjectAssignment } from '@/components/staff/StaffProjectAssignment';
import { OverviewTab } from './tabs/OverviewTab';
import { EmploymentTab } from './tabs/EmploymentTab';
import { ComplianceTab } from './tabs/ComplianceTab';
import { VehiclesTab } from './tabs/VehiclesTab';
import { DisciplinaryTab } from './tabs/DisciplinaryTab';
import { NotesTab } from './tabs/NotesTab';
import { DisciplinaryIncidentForm } from './DisciplinaryIncidentForm';
import { VehicleAssignmentForm } from './VehicleAssignmentForm';
import type { DisciplinaryIncident, VehicleAssignment } from '@/types/staff';

type TabType = 'overview' | 'employment' | 'compliance' | 'vehicles' | 'disciplinary' | 'documents' | 'projects' | 'notes';

const TABS: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: User },
  { id: 'employment', label: 'Employment', icon: Briefcase },
  { id: 'compliance', label: 'Compliance', icon: Shield },
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'disciplinary', label: 'Disciplinary', icon: AlertTriangle },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'notes', label: 'Notes', icon: MessageSquare },
];

export function StaffDetail() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { data: staff, isLoading, error, refetch } = useStaffMember(id || '');
  const deleteMutation = useDeleteStaff();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Modal states
  const [showDisciplinaryForm, setShowDisciplinaryForm] = useState(false);
  const [editingIncident, setEditingIncident] = useState<DisciplinaryIncident | null>(null);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleAssignment | null>(null);
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);
  const [hasValidLicense, setHasValidLicense] = useState(false);

  // Fetch license status when staff ID changes
  useEffect(() => {
    if (!id) return;

    const fetchLicenseStatus = async () => {
      try {
        const response = await fetch(`/api/staff/${id}/vehicles`);
        if (response.ok) {
          const data = await response.json();
          setHasValidLicense(data.hasValidLicense || false);
        }
      } catch (err) {
        log.error('Failed to fetch license status', { error: err });
      }
    };

    fetchLicenseStatus();
  }, [id]);

  // Fetch staff list for issued by dropdown
  const fetchStaffList = useCallback(async () => {
    try {
      const response = await fetch('/api/staff?limit=100');
      if (response.ok) {
        const data = await response.json();
        setStaffList(data.staff?.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })) || []);
      }
    } catch (err) {
      log.error('Failed to fetch staff list', { error: err });
    }
  }, []);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this staff member?')) return;

    try {
      await deleteMutation.mutateAsync(id!);
      notificationService.success('Staff member deleted');
      router.push('/app/staff');
    } catch (err) {
      log.error('Failed to delete staff member', { error: err });
      notificationService.error('Failed to delete staff member');
    }
  };

  const handleVerifyDocument = async (documentId: string, status: 'verified' | 'rejected', notes?: string) => {
    try {
      const response = await fetch(`/api/staff-documents/${documentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });

      if (!response.ok) {
        throw new Error('Failed to verify document');
      }

      notificationService.success(`Document ${status === 'verified' ? 'verified' : 'rejected'}`);
      router.replace(router.asPath);
    } catch (err) {
      log.error('Document verification failed', { documentId, error: err });
      notificationService.error('Failed to verify document');
    }
  };

  // CV Upload handler
  const handleCvUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/api/staff/${id}/cv-upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to upload CV');
    }

    await refetch();
  };

  const handleCvDelete = async () => {
    if (!confirm('Are you sure you want to remove the CV?')) return;

    const response = await fetch(`/api/staff/${id}/cv-upload`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete CV');
    }

    await refetch();
  };

  // Profile Photo handlers
  const handleProfilePhotoUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/api/staff/${id}/profile-photo`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to upload profile photo');
    }

    await refetch();
  };

  const handleProfilePhotoDelete = async () => {
    if (!confirm('Are you sure you want to remove the profile photo?')) return;

    const response = await fetch(`/api/staff/${id}/profile-photo`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete profile photo');
    }

    await refetch();
  };

  const handleComparePhotos = async () => {
    // TODO: Implement face comparison with Qwen3 VLM when ready
    const response = await fetch(`/api/staff/${id}/compare-photos`, {
      method: 'POST',
    });

    if (!response.ok) {
      const data = await response.json();
      notificationService.error(data.error || 'Failed to compare photos');
      return;
    }

    notificationService.success('Photos compared successfully');
    await refetch();
  };

  // Disciplinary handlers
  const handleAddIncident = () => {
    fetchStaffList();
    setEditingIncident(null);
    setShowDisciplinaryForm(true);
  };

  const handleEditIncident = (incident: DisciplinaryIncident) => {
    fetchStaffList();
    setEditingIncident(incident);
    setShowDisciplinaryForm(true);
  };

  const handleSaveIncident = async (incident: Partial<DisciplinaryIncident>) => {
    const method = incident.id ? 'PUT' : 'POST';
    const response = await fetch(`/api/staff/${id}/disciplinary`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incident),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save incident');
    }

    router.replace(router.asPath);
  };

  // Vehicle handlers
  const handleAddVehicle = () => {
    setEditingVehicle(null);
    setShowVehicleForm(true);
  };

  const handleEditVehicle = (vehicle: VehicleAssignment) => {
    setEditingVehicle(vehicle);
    setShowVehicleForm(true);
  };

  const handleRemoveVehicle = async (vehicleId: string) => {
    if (!confirm('Are you sure you want to remove this vehicle assignment?')) return;

    const response = await fetch(`/api/staff/${id}/vehicles?id=${vehicleId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      notificationService.error('Failed to remove vehicle assignment');
      return;
    }

    notificationService.success('Vehicle assignment removed');
    router.replace(router.asPath);
  };

  const handleSaveVehicle = async (vehicle: Partial<VehicleAssignment>) => {
    const method = vehicle.id ? 'PUT' : 'POST';
    const response = await fetch(`/api/staff/${id}/vehicles`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vehicle),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save vehicle assignment');
    }

    router.replace(router.asPath);
  };

  // Document upload handler
  const handleUploadDocument = (documentType: string) => {
    // Switch to documents tab with the document type pre-selected
    setActiveTab('documents');
    // The StaffDocumentList component handles the actual upload
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400">Staff member not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push('/staff')}
          className="inline-flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Staff List
        </button>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 bg-blue-500/20 rounded-full flex items-center justify-center">
                <span className="text-xl font-medium text-blue-400">
                  {staff.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">{staff.name}</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  {staff.position || 'No position'} {staff.employeeId && `• ${staff.employeeId}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push(`/staff/${id}/edit`)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
              >
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm font-medium text-red-400 bg-[var(--ff-bg-tertiary)] border border-red-500/30 rounded-lg hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--ff-border-light)] overflow-x-auto">
          <nav className="flex -mb-px px-6" aria-label="Tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-3 px-4 text-sm font-medium border-b-2 flex items-center gap-2 whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === 'overview' && (
            <OverviewTab
              staff={staff}
              onCvUpload={handleCvUpload}
              onCvDelete={handleCvDelete}
              onProfilePhotoUpload={handleProfilePhotoUpload}
              onProfilePhotoDelete={handleProfilePhotoDelete}
              onComparePhotos={handleComparePhotos}
            />
          )}

          {activeTab === 'employment' && (
            <EmploymentTab staff={staff} />
          )}

          {activeTab === 'compliance' && (
            <ComplianceTab
              staff={staff}
              onUploadDocument={handleUploadDocument}
            />
          )}

          {activeTab === 'vehicles' && (
            <VehiclesTab
              staffId={id}
              staffName={staff.name}
              onAddVehicle={handleAddVehicle}
              onEditVehicle={handleEditVehicle}
              onRemoveVehicle={handleRemoveVehicle}
            />
          )}

          {activeTab === 'disciplinary' && (
            <DisciplinaryTab
              staffId={id}
              onAddIncident={handleAddIncident}
              onEditIncident={handleEditIncident}
            />
          )}

          {activeTab === 'documents' && (
            <StaffDocumentList staffId={id} isAdmin={true} onVerify={handleVerifyDocument} />
          )}

          {activeTab === 'projects' && (
            <StaffProjectAssignment staffId={id} staffName={staff.name} />
          )}

          {activeTab === 'notes' && (
            <NotesTab staff={staff} staffId={id} />
          )}
        </div>
      </div>

      {/* Disciplinary Form Modal */}
      {showDisciplinaryForm && (
        <DisciplinaryIncidentForm
          staffId={id}
          incident={editingIncident}
          issuedByOptions={staffList}
          onSave={handleSaveIncident}
          onClose={() => {
            setShowDisciplinaryForm(false);
            setEditingIncident(null);
          }}
        />
      )}

      {/* Vehicle Form Modal */}
      {showVehicleForm && (
        <VehicleAssignmentForm
          staffId={id}
          staffName={staff.name}
          hasValidLicense={hasValidLicense}
          vehicle={editingVehicle}
          onSave={handleSaveVehicle}
          onClose={() => {
            setShowVehicleForm(false);
            setEditingVehicle(null);
          }}
        />
      )}
    </div>
  );
}
