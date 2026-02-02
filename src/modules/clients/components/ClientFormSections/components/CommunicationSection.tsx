import { SectionProps, ContactMethod } from '../types/clientForm.types';

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-primary)] mb-1";

export function CommunicationSection({ formData, handleInputChange }: SectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Communication Preferences</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>
            Preferred Contact Method
          </label>
          <select
            value={formData.preferredContactMethod}
            onChange={(e) => handleInputChange('preferredContactMethod', e.target.value as ContactMethod)}
            className={inputClasses}
          >
            {Object.values(ContactMethod).map(method => (
              <option key={method} value={method}>
                {method.replace(/_/g, ' ').charAt(0).toUpperCase() + method.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClasses}>
            Language
          </label>
          <input
            type="text"
            value={formData.communicationLanguage}
            onChange={(e) => handleInputChange('communicationLanguage', e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Timezone
          </label>
          <input
            type="text"
            value={formData.timezone}
            onChange={(e) => handleInputChange('timezone', e.target.value)}
            className={inputClasses}
          />
        </div>
      </div>
    </div>
  );
}