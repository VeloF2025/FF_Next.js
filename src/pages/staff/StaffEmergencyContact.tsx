/**
 * Staff Emergency Contact Form Section
 */

import { StaffFormData } from '@/types/staff.types';

interface StaffEmergencyContactProps {
  formData: StaffFormData;
  onInputChange: (field: keyof StaffFormData, value: any) => void;
}

export function StaffEmergencyContact({ formData, onInputChange }: StaffEmergencyContactProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-foreground mb-4">Emergency Contact</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Contact Name
          </label>
          <input
            type="text"
            value={formData.emergencyContactName}
            onChange={(e) => onInputChange('emergencyContactName', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Contact Phone
          </label>
          <input
            type="tel"
            value={formData.emergencyContactPhone}
            onChange={(e) => onInputChange('emergencyContactPhone', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}