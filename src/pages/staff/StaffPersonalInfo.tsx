/**
 * Staff Personal Information Form Section
 */

import { StaffFormData } from '@/types/staff.types';

interface StaffPersonalInfoProps {
  formData: StaffFormData;
  onInputChange: (field: keyof StaffFormData, value: StaffFormData[keyof StaffFormData]) => void;
}

export function StaffPersonalInfo({ formData, onInputChange }: StaffPersonalInfoProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-foreground mb-4">Personal Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Full Name *
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => onInputChange('name', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Employee ID
          </label>
          <input
            type="text"
            value={formData.employeeId}
            onChange={(e) => onInputChange('employeeId', e.target.value)}
            placeholder="Auto-generated if left empty"
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Email *
          </label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) => onInputChange('email', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Phone *
          </label>
          <input
            type="tel"
            required
            value={formData.phone}
            onChange={(e) => onInputChange('phone', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Alternative Phone
          </label>
          <input
            type="tel"
            value={formData.alternativePhone}
            onChange={(e) => onInputChange('alternativePhone', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}