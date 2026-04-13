import { StaffFormData } from '@/types/staff.types';

interface AvailabilitySectionProps {
  formData: StaffFormData;
  handleInputChange: (field: keyof StaffFormData, value: StaffFormData[keyof StaffFormData]) => void;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";

export function AvailabilitySection({ formData, handleInputChange }: AvailabilitySectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Availability & Scheduling</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>
            Working Hours
          </label>
          <input
            type="text"
            value={formData.workingHours}
            onChange={(e) => handleInputChange('workingHours', e.target.value)}
            placeholder="e.g., 8:00 AM - 5:00 PM"
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Time Zone
          </label>
          <select
            value={formData.timeZone}
            onChange={(e) => handleInputChange('timeZone', e.target.value)}
            className={inputClasses}
          >
            <option value="CAT">CAT (Central Africa Time)</option>
            <option value="SAST">SAST (South African Standard Time)</option>
            <option value="EAT">EAT (East Africa Time)</option>
            <option value="WAT">WAT (West Africa Time)</option>
          </select>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.availableWeekends}
              onChange={(e) => handleInputChange('availableWeekends', e.target.checked)}
              className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)]"
            />
            <span className="text-sm text-[var(--ff-text-secondary)]">Available Weekends</span>
          </label>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.availableNights}
              onChange={(e) => handleInputChange('availableNights', e.target.checked)}
              className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500 bg-[var(--ff-bg-tertiary)]"
            />
            <span className="text-sm text-[var(--ff-text-secondary)]">Available Nights</span>
          </label>
        </div>
      </div>
    </div>
  );
}
