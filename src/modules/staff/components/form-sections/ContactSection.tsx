import { StaffFormData } from '@/types/staff.types';

interface ContactSectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: StaffFormData[keyof StaffFormData]) => void;
}

const provinces = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape'
];

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";

export function ContactSection({ formData, handleInputChange }: ContactSectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contact & Address</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className={labelClasses}>
            Address *
          </label>
          <textarea
            required
            value={formData.address}
            onChange={(e) => handleInputChange('address', e.target.value)}
            rows={2}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            City *
          </label>
          <input
            type="text"
            required
            value={formData.city}
            onChange={(e) => handleInputChange('city', e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Province *
          </label>
          <select
            value={formData.province}
            onChange={(e) => handleInputChange('province', e.target.value)}
            className={inputClasses}
          >
            {provinces.map(province => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClasses}>
            Postal Code *
          </label>
          <input
            type="text"
            required
            value={formData.postalCode}
            onChange={(e) => handleInputChange('postalCode', e.target.value)}
            className={inputClasses}
          />
        </div>
      </div>
    </div>
  );
}

export function EmergencyContactSection({ formData, handleInputChange }: ContactSectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Emergency Contact</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>
            Contact Name
          </label>
          <input
            type="text"
            value={formData.emergencyContactName || ''}
            onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Contact Phone
          </label>
          <input
            type="tel"
            value={formData.emergencyContactPhone || ''}
            onChange={(e) => handleInputChange('emergencyContactPhone', e.target.value)}
            className={inputClasses}
          />
        </div>
      </div>
    </div>
  );
}
