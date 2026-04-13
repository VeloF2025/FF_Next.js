import { ClientFormData } from '@/types/client.types';

interface AddressFieldsProps {
  formData: ClientFormData;
  onChange: (field: keyof ClientFormData, value: unknown) => void;
}

export function AddressFields({ formData, onChange }: AddressFieldsProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-neutral-900 mb-4">Address Information</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Street Address <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            value={formData.address.street}
            onChange={(e) => onChange('address', { ...formData.address, street: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            City <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            value={formData.address.city}
            onChange={(e) => onChange('address', { ...formData.address, city: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            State/Province <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            value={formData.address.state}
            onChange={(e) => onChange('address', { ...formData.address, state: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Postal Code <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            value={formData.address.postalCode}
            onChange={(e) => onChange('address', { ...formData.address, postalCode: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Country <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            value={formData.address.country}
            onChange={(e) => onChange('address', { ...formData.address, country: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
        </div>
      </div>

      {/* Billing Address */}
      <div className="mt-6">
        <div className="flex items-center mb-4">
          <input
            type="checkbox"
            id="sameBillingAddress"
            checked={formData.billingAddress?.sameAsPhysical}
            onChange={(e) => onChange('billingAddress', { 
              ...formData.billingAddress, 
              sameAsPhysical: e.target.checked 
            })}
            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-neutral-300 rounded"
          />
          <label htmlFor="sameBillingAddress" className="ml-2 text-sm text-neutral-700">
            Billing address same as physical address
          </label>
        </div>

        {!formData.billingAddress?.sameAsPhysical && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Billing Street Address
              </label>
              <input
                type="text"
                value={formData.billingAddress?.street}
                onChange={(e) => onChange('billingAddress', { 
                  ...formData.billingAddress, 
                  street: e.target.value 
                })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Billing City
              </label>
              <input
                type="text"
                value={formData.billingAddress?.city}
                onChange={(e) => onChange('billingAddress', { 
                  ...formData.billingAddress, 
                  city: e.target.value 
                })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Billing State/Province
              </label>
              <input
                type="text"
                value={formData.billingAddress?.state}
                onChange={(e) => onChange('billingAddress', { 
                  ...formData.billingAddress, 
                  state: e.target.value 
                })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Billing Postal Code
              </label>
              <input
                type="text"
                value={formData.billingAddress?.postalCode}
                onChange={(e) => onChange('billingAddress', { 
                  ...formData.billingAddress, 
                  postalCode: e.target.value 
                })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Billing Country
              </label>
              <input
                type="text"
                value={formData.billingAddress?.country}
                onChange={(e) => onChange('billingAddress', { 
                  ...formData.billingAddress, 
                  country: e.target.value 
                })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}