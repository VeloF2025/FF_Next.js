import { SectionProps } from '../types/clientForm.types';

const provinces = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal',
  'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'
];

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-primary)] mb-1";

export function AddressSection({ formData, handleInputChange }: SectionProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Address</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className={labelClasses}>
            Street Address *
          </label>
          <input
            type="text"
            required
            value={formData.address?.street || ''}
            onChange={(e) => handleInputChange('address', { ...formData.address, street: e.target.value })}
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
            value={formData.address?.city || ''}
            onChange={(e) => handleInputChange('address', { ...formData.address, city: e.target.value })}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Province *
          </label>
          <select
            value={formData.address?.state || ''}
            onChange={(e) => handleInputChange('address', { ...formData.address, state: e.target.value })}
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
            value={formData.address?.postalCode || ''}
            onChange={(e) => handleInputChange('address', { ...formData.address, postalCode: e.target.value })}
            className={inputClasses}
          />
        </div>

        <div>
          <label className={labelClasses}>
            Country *
          </label>
          <input
            type="text"
            required
            value={formData.address?.country || ''}
            onChange={(e) => handleInputChange('address', { ...formData.address, country: e.target.value })}
            className={inputClasses}
          />
        </div>
      </div>
    </div>
  );
}