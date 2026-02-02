import { SectionProps, ClientStatus, ClientCategory, ClientPriority } from '../types/clientForm.types';

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-primary)] mb-1";

export function CompanyDetailsSection({ formData, handleInputChange }: SectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Company Details</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>
            Registration Number
          </label>
          <input
            type="text"
            value={formData.registrationNumber}
            onChange={(e) => handleInputChange('registrationNumber', e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            VAT Number
          </label>
          <input
            type="text"
            value={formData.vatNumber}
            onChange={(e) => handleInputChange('vatNumber', e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Industry
          </label>
          <input
            type="text"
            value={formData.industry}
            onChange={(e) => handleInputChange('industry', e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Website
          </label>
          <input
            type="url"
            value={formData.website}
            onChange={(e) => handleInputChange('website', e.target.value)}
            placeholder="https://example.com"
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Status
          </label>
          <select
            value={formData.status}
            onChange={(e) => handleInputChange('status', e.target.value as ClientStatus)}
            className={inputClasses}
          >
            {Object.values(ClientStatus).map(status => (
              <option key={status} value={status}>
                {status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClasses}>
            Category
          </label>
          <select
            value={formData.category}
            onChange={(e) => handleInputChange('category', e.target.value as ClientCategory)}
            className={inputClasses}
          >
            {Object.values(ClientCategory).map(category => (
              <option key={category} value={category}>
                {category.replace('_', ' ').charAt(0).toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClasses}>
            Priority
          </label>
          <select
            value={formData.priority}
            onChange={(e) => handleInputChange('priority', e.target.value as ClientPriority)}
            className={inputClasses}
          >
            {Object.values(ClientPriority).map(priority => (
              <option key={priority} value={priority}>
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}