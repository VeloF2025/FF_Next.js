/**
 * User Profile Page
 * Displays and allows editing of user profile linked to staff record
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { AppLayout } from '@/components/layout';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { VelocityInput } from '@/components/ui/VelocityInput';
import { useAuth } from '@/contexts/AuthContext';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Calendar,
  Shield,
  AlertCircle,
  Save,
  X,
  Edit2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  department?: string;
  profilePicture?: string;
  lastLogin?: string;
  createdAt: string;
  staffId?: string;
  employeeId?: string;
  position?: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  hireDate?: string;
  birthDate?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  skills?: string[];
  certifications?: Array<{
    name: string;
    issuedDate?: string;
    expiryDate?: string;
  }>;
  contractType?: string;
  availabilityStatus?: string;
}

export default function ProfilePage() {
  const { currentUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    alternatePhone: '',
    address: '',
    city: '',
    country: '',
    postalCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/users/profile');
      const data = await res.json();

      if (!data.success) {
        setError(data.error?.message || 'Failed to load profile');
        return;
      }

      setProfile(data.data);
      setFormData({
        firstName: data.data.firstName || '',
        lastName: data.data.lastName || '',
        phone: data.data.phone || '',
        alternatePhone: data.data.alternatePhone || '',
        address: data.data.address || '',
        city: data.data.city || '',
        country: data.data.country || '',
        postalCode: data.data.postalCode || '',
        emergencyContactName: data.data.emergencyContact?.name || '',
        emergencyContactPhone: data.data.emergencyContact?.phone || '',
        emergencyContactRelationship: data.data.emergencyContact?.relationship || '',
      });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/users/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone,
          alternatePhone: formData.alternatePhone,
          address: formData.address,
          city: formData.city,
          country: formData.country,
          postalCode: formData.postalCode,
          emergencyContact: formData.emergencyContactName ? {
            name: formData.emergencyContactName,
            phone: formData.emergencyContactPhone,
            relationship: formData.emergencyContactRelationship,
          } : undefined,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        toast.error(data.error?.message || 'Failed to save');
        return;
      }

      setProfile(data.data);
      setEditing(false);
      toast.success('Profile updated successfully');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setFormData({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        phone: profile.phone || '',
        alternatePhone: profile.alternatePhone || '',
        address: profile.address || '',
        city: profile.city || '',
        country: profile.country || '',
        postalCode: profile.postalCode || '',
        emergencyContactName: profile.emergencyContact?.name || '',
        emergencyContactPhone: profile.emergencyContact?.phone || '',
        emergencyContactRelationship: profile.emergencyContact?.relationship || '',
      });
    }
    setEditing(false);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'manager':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'technician':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <AlertCircle className="w-12 h-12 text-red-400" />
          <p className="text-red-400">{error}</p>
          <VelocityButton onClick={fetchProfile}>Retry</VelocityButton>
        </div>
      </AppLayout>
    );
  }

  if (!profile) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-slate-400">Profile not found</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <>
      <Head>
        <title>My Profile | FibreFlow</title>
      </Head>

      <AppLayout>
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">My Profile</h1>
              <p className="text-slate-400">Manage your personal information</p>
            </div>
            {!editing ? (
              <VelocityButton
                variant="outline"
                onClick={() => setEditing(true)}
                icon={<Edit2 className="w-4 h-4" />}
              >
                Edit Profile
              </VelocityButton>
            ) : (
              <div className="flex gap-2">
                <VelocityButton
                  variant="outline"
                  onClick={handleCancel}
                  icon={<X className="w-4 h-4" />}
                >
                  Cancel
                </VelocityButton>
                <VelocityButton
                  variant="gradient"
                  onClick={handleSave}
                  loading={saving}
                  icon={<Save className="w-4 h-4" />}
                >
                  Save Changes
                </VelocityButton>
              </div>
            )}
          </div>

          {/* Profile Header Card */}
          <GlassCard variant="default" padding="lg">
            <div className="flex items-center gap-6">
              {/* Avatar */}
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-3xl font-bold text-white shadow-lg">
                {(profile.firstName?.[0] || profile.email[0]).toUpperCase()}
                {(profile.lastName?.[0] || '').toUpperCase()}
              </div>

              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white">
                  {profile.firstName} {profile.lastName}
                </h2>
                <p className="text-slate-400">{profile.email}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getRoleBadgeColor(profile.role)}`}>
                    {profile.role.toUpperCase()}
                  </span>
                  {profile.position && (
                    <span className="text-sm text-slate-400">{profile.position}</span>
                  )}
                  {profile.department && (
                    <span className="text-sm text-slate-500">• {profile.department}</span>
                  )}
                </div>
              </div>

              {profile.staffId && (
                <div className="text-right">
                  <p className="text-xs text-slate-500">Employee ID</p>
                  <p className="text-sm font-mono text-slate-300">{profile.employeeId || 'N/A'}</p>
                </div>
              )}
            </div>
          </GlassCard>

          {/* Access Status Banner */}
          {!profile.staffId && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-amber-200 font-medium">Limited Access</p>
                <p className="text-sm text-amber-300/70">
                  Your access control has not been fully configured yet. Please contact your administrator to set up your role and permissions.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Personal Information */}
            <GlassCard variant="default" padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-white">Personal Information</h3>
              </div>

              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <VelocityInput
                      label="First Name"
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      variant="glass"
                    />
                    <VelocityInput
                      label="Last Name"
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      variant="glass"
                    />
                  </div>
                  <VelocityInput
                    label="Phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    variant="glass"
                    icon={<Phone className="w-4 h-4" />}
                    iconPosition="left"
                  />
                  <VelocityInput
                    label="Alternate Phone"
                    value={formData.alternatePhone}
                    onChange={(e) => setFormData({ ...formData, alternatePhone: e.target.value })}
                    variant="glass"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <InfoRow icon={<User />} label="Full Name" value={`${profile.firstName} ${profile.lastName}`} />
                  <InfoRow icon={<Mail />} label="Email" value={profile.email} />
                  <InfoRow icon={<Phone />} label="Phone" value={profile.phone || '-'} />
                  <InfoRow icon={<Phone />} label="Alternate Phone" value={profile.alternatePhone || '-'} />
                </div>
              )}
            </GlassCard>

            {/* Address */}
            <GlassCard variant="default" padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-white">Address</h3>
              </div>

              {editing ? (
                <div className="space-y-4">
                  <VelocityInput
                    label="Street Address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    variant="glass"
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <VelocityInput
                      label="City"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      variant="glass"
                    />
                    <VelocityInput
                      label="Postal Code"
                      value={formData.postalCode}
                      onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                      variant="glass"
                    />
                  </div>
                  <VelocityInput
                    label="Country"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    variant="glass"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <InfoRow icon={<MapPin />} label="Address" value={profile.address || '-'} />
                  <InfoRow icon={null} label="City" value={profile.city || '-'} />
                  <InfoRow icon={null} label="Postal Code" value={profile.postalCode || '-'} />
                  <InfoRow icon={null} label="Country" value={profile.country || '-'} />
                </div>
              )}
            </GlassCard>

            {/* Employment Details */}
            <GlassCard variant="default" padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Briefcase className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-white">Employment</h3>
              </div>

              <div className="space-y-3">
                <InfoRow icon={<Shield />} label="Role" value={profile.role} />
                <InfoRow icon={<Briefcase />} label="Position" value={profile.position || '-'} />
                <InfoRow icon={null} label="Department" value={profile.department || '-'} />
                <InfoRow icon={null} label="Contract Type" value={profile.contractType || '-'} />
                <InfoRow icon={<Calendar />} label="Hire Date" value={formatDate(profile.hireDate)} />
              </div>
            </GlassCard>

            {/* Emergency Contact */}
            <GlassCard variant="default" padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-white">Emergency Contact</h3>
              </div>

              {editing ? (
                <div className="space-y-4">
                  <VelocityInput
                    label="Contact Name"
                    value={formData.emergencyContactName}
                    onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                    variant="glass"
                  />
                  <VelocityInput
                    label="Contact Phone"
                    value={formData.emergencyContactPhone}
                    onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                    variant="glass"
                  />
                  <VelocityInput
                    label="Relationship"
                    value={formData.emergencyContactRelationship}
                    onChange={(e) => setFormData({ ...formData, emergencyContactRelationship: e.target.value })}
                    variant="glass"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <InfoRow icon={<User />} label="Name" value={profile.emergencyContact?.name || '-'} />
                  <InfoRow icon={<Phone />} label="Phone" value={profile.emergencyContact?.phone || '-'} />
                  <InfoRow icon={null} label="Relationship" value={profile.emergencyContact?.relationship || '-'} />
                </div>
              )}
            </GlassCard>
          </div>

          {/* Skills & Certifications (Read-only) */}
          {(profile.skills?.length || profile.certifications?.length) && (
            <GlassCard variant="default" padding="lg">
              <h3 className="text-lg font-semibold text-white mb-4">Skills & Certifications</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {profile.skills && profile.skills.length > 0 && (
                  <div>
                    <p className="text-sm text-slate-400 mb-2">Skills</p>
                    <div className="flex flex-wrap gap-2">
                      {profile.skills.map((skill, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-slate-700/50 rounded-full text-sm text-slate-300"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {profile.certifications && profile.certifications.length > 0 && (
                  <div>
                    <p className="text-sm text-slate-400 mb-2">Certifications</p>
                    <div className="space-y-2">
                      {profile.certifications.map((cert, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-slate-700/30 rounded">
                          <span className="text-sm text-slate-300">{cert.name}</span>
                          {cert.expiryDate && (
                            <span className="text-xs text-slate-500">
                              Expires: {formatDate(cert.expiryDate)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </GlassCard>
          )}

          {/* Account Info */}
          <GlassCard variant="default" padding="lg">
            <h3 className="text-lg font-semibold text-white mb-4">Account Information</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-slate-500">Account Created</p>
                <p className="text-sm text-slate-300">{formatDate(profile.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Last Login</p>
                <p className="text-sm text-slate-300">{formatDate(profile.lastLogin)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Status</p>
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs rounded">Active</span>
              </div>
              <div>
                <p className="text-xs text-slate-500">Staff Linked</p>
                <span className={`px-2 py-0.5 text-xs rounded ${profile.staffId ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  {profile.staffId ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </GlassCard>
        </div>
      </AppLayout>
    </>
  );
}

// Helper component for displaying info rows
function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      {icon && <span className="text-slate-500 w-4 h-4">{icon}</span>}
      <div className={icon ? '' : 'ml-7'}>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm text-slate-300">{value}</p>
      </div>
    </div>
  );
}
