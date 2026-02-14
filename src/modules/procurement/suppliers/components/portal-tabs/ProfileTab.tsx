import React, { useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import type { Supplier } from '@/types/supplier/base.types';

export interface ProfileTabProps {
  supplier: Supplier | null;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({ supplier }) => {
  const [editing, setEditing] = useState(false);
  const [profileData] = useState(supplier);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-foreground">Company Profile</h2>
        <VelocityButton
          onClick={() => setEditing(!editing)}
          variant={editing ? 'outline' : 'solid'}
        >
          {editing ? 'Cancel' : 'Edit Profile'}
        </VelocityButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard>
          <h3 className="text-lg font-semibold text-foreground mb-4">Company Information</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground">Company Name</label>
              <input
                type="text"
                value={profileData?.name || ''}
                readOnly={!editing}
                className={`mt-1 block w-full px-3 py-2 border rounded-lg ${
                  editing ? 'border-border focus:ring-blue-500 focus:border-blue-500' : 'border-border bg-background'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground">Registration Number</label>
              <input
                type="text"
                value={profileData?.code || ''}
                readOnly={!editing}
                className={`mt-1 block w-full px-3 py-2 border rounded-lg ${
                  editing ? 'border-border focus:ring-blue-500 focus:border-blue-500' : 'border-border bg-background'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground">Business Type</label>
              <select
                value={profileData?.businessType || ''}
                disabled={!editing}
                className={`mt-1 block w-full px-3 py-2 border rounded-lg ${
                  editing ? 'border-border focus:ring-blue-500 focus:border-blue-500' : 'border-border bg-background'
                }`}
              >
                <option value="manufacturer">Manufacturer</option>
                <option value="distributor">Distributor</option>
                <option value="service_provider">Service Provider</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-lg font-semibold text-foreground mb-4">Contact Information</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground">Primary Contact</label>
              <input
                type="text"
                value={profileData?.primaryContact?.name || ''}
                readOnly={!editing}
                className={`mt-1 block w-full px-3 py-2 border rounded-lg ${
                  editing ? 'border-border focus:ring-blue-500 focus:border-blue-500' : 'border-border bg-background'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                value={profileData?.primaryContact?.email || ''}
                readOnly={!editing}
                className={`mt-1 block w-full px-3 py-2 border rounded-lg ${
                  editing ? 'border-border focus:ring-blue-500 focus:border-blue-500' : 'border-border bg-background'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground">Phone</label>
              <input
                type="tel"
                value={profileData?.primaryContact?.phone || ''}
                readOnly={!editing}
                className={`mt-1 block w-full px-3 py-2 border rounded-lg ${
                  editing ? 'border-border focus:ring-blue-500 focus:border-blue-500' : 'border-border bg-background'
                }`}
              />
            </div>
          </div>
        </GlassCard>
      </div>

      {editing && (
        <div className="flex justify-end space-x-3">
          <VelocityButton variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </VelocityButton>
          <VelocityButton onClick={() => setEditing(false)}>
            Save Changes
          </VelocityButton>
        </div>
      )}
    </div>
  );
};
