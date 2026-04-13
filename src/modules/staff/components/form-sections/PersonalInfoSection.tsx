import { StaffFormData } from '@/types/staff.types';

interface PersonalInfoSectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: StaffFormData[keyof StaffFormData]) => void;
  isCreating?: boolean;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-secondary)]";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";

export function PersonalInfoSection({ formData, handleInputChange, isCreating }: PersonalInfoSectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Personal Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>
            Full Name *
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            className={inputClasses}
            placeholder="First and last name"
          />
        </div>

        {!isCreating && (
          <div>
            <label className={labelClasses}>
              Employee ID
            </label>
            <input
              type="text"
              value={formData.employeeId}
              disabled
              className={`${inputClasses} opacity-60 cursor-not-allowed`}
            />
          </div>
        )}

        <div>
          <label className={labelClasses}>
            Email *
          </label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            className={inputClasses}
            placeholder="email@example.com"
          />
        </div>

        <div>
          <label className={labelClasses}>
            Phone *
          </label>
          <input
            type="tel"
            required
            value={formData.phone}
            onChange={(e) => handleInputChange('phone', e.target.value)}
            className={inputClasses}
            placeholder="+27..."
          />
        </div>

        {!isCreating && (
          <div>
            <label className={labelClasses}>
              Alternative Phone
            </label>
            <input
              type="tel"
              value={formData.alternativePhone || ''}
              onChange={(e) => handleInputChange('alternativePhone', e.target.value)}
              className={inputClasses}
            />
          </div>
        )}
      </div>
    </div>
  );
}