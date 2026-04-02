'use client';

import { StaffFormData } from '@/types/staff.types';

interface OverviewEditSectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: unknown) => void;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-secondary)]";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";

export function OverviewEditSection({ formData, handleInputChange }: OverviewEditSectionProps) {
  return (
    <div className="space-y-8">
      {/* Personal Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Personal Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Full Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Employee ID *</label>
            <input
              type="text"
              required
              value={formData.employeeId}
              onChange={(e) => handleInputChange('employeeId', e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contact Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Email *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Phone *</label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Alternative Phone</label>
            <input
              type="tel"
              value={formData.alternativePhone || ''}
              onChange={(e) => handleInputChange('alternativePhone', e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>WhatsApp ID</label>
            <input
              type="text"
              value={formData.whatsappId || ''}
              onChange={(e) => handleInputChange('whatsappId', e.target.value)}
              className={inputClasses}
              placeholder="e.g., 27831234567@s.whatsapp.net"
            />
            <p className="mt-1 text-xs text-[var(--ff-text-secondary)]">
              Used for QA feedback and direct messaging
            </p>
          </div>
        </div>
      </div>

      {/* Address */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Address</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className={labelClasses}>Street Address</label>
            <input
              type="text"
              value={formData.address || ''}
              onChange={(e) => handleInputChange('address', e.target.value)}
              className={inputClasses}
              placeholder="Street address"
            />
          </div>

          <div>
            <label className={labelClasses}>City</label>
            <input
              type="text"
              value={formData.city || ''}
              onChange={(e) => handleInputChange('city', e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Province</label>
            <select
              value={formData.province || ''}
              onChange={(e) => handleInputChange('province', e.target.value)}
              className={inputClasses}
            >
              <option value="">Select Province</option>
              <option value="Eastern Cape">Eastern Cape</option>
              <option value="Free State">Free State</option>
              <option value="Gauteng">Gauteng</option>
              <option value="KwaZulu-Natal">KwaZulu-Natal</option>
              <option value="Limpopo">Limpopo</option>
              <option value="Mpumalanga">Mpumalanga</option>
              <option value="North West">North West</option>
              <option value="Northern Cape">Northern Cape</option>
              <option value="Western Cape">Western Cape</option>
            </select>
          </div>

          <div>
            <label className={labelClasses}>Postal Code</label>
            <input
              type="text"
              value={formData.postalCode || ''}
              onChange={(e) => handleInputChange('postalCode', e.target.value)}
              className={inputClasses}
            />
          </div>
        </div>
      </div>

      {/* Emergency Contact */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Emergency Contact</h2>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>Contact Name</label>
              <input
                type="text"
                value={formData.emergencyContactName || ''}
                onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                className={inputClasses}
                placeholder="Emergency contact name"
              />
            </div>

            <div>
              <label className={labelClasses}>Relationship</label>
              <input
                type="text"
                value={formData.emergencyContactRelationship || ''}
                onChange={(e) => handleInputChange('emergencyContactRelationship', e.target.value)}
                className={inputClasses}
                placeholder="e.g., Spouse, Parent, Sibling"
              />
            </div>

            <div>
              <label className={labelClasses}>Contact Phone</label>
              <input
                type="tel"
                value={formData.emergencyContactPhone || ''}
                onChange={(e) => handleInputChange('emergencyContactPhone', e.target.value)}
                className={inputClasses}
                placeholder="Emergency contact phone"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Identity Documents */}
      <div>
        <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Identity Documents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">SA ID</h3>
            <div>
              <label className={labelClasses}>SA ID Number</label>
              <input
                type="text"
                maxLength={13}
                value={formData.saIdNumber || ''}
                onChange={(e) => handleInputChange('saIdNumber', e.target.value.replace(/\D/g, ''))}
                className={inputClasses}
                placeholder="13-digit SA ID number"
              />
            </div>
          </div>

          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Passport (Foreign Nationals)</h3>
            <div className="space-y-3">
              <div>
                <label className={labelClasses}>Passport Number</label>
                <input
                  type="text"
                  value={formData.passportNumber || ''}
                  onChange={(e) => handleInputChange('passportNumber', e.target.value)}
                  className={inputClasses}
                  placeholder="Passport number"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Country</label>
                  <input
                    type="text"
                    value={formData.passportCountry || ''}
                    onChange={(e) => handleInputChange('passportCountry', e.target.value)}
                    className={inputClasses}
                    placeholder="Country"
                  />
                </div>

                <div>
                  <label className={labelClasses}>Expiry Date</label>
                  <input
                    type="date"
                    value={formData.passportExpiry instanceof Date ? formData.passportExpiry.toISOString().split('T')[0] : ''}
                    onChange={(e) => handleInputChange('passportExpiry', e.target.value ? new Date(e.target.value) : undefined)}
                    className={inputClasses}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
