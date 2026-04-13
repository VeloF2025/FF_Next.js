import { ClientFormData } from '@/types/client.types';

interface ClientFormFieldsProps {
  formData: ClientFormData;
  onChange: (field: keyof ClientFormData, value: unknown) => void;
}

export function ClientFormFields({ formData, onChange }: ClientFormFieldsProps) {
  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div>
        <h3 className="text-lg font-semibold text-neutral-900 mb-4">Basic Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Company Name <span className="text-error-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Registration Number
            </label>
            <input
              type="text"
              value={formData.registrationNumber || ''}
              onChange={(e) => onChange('registrationNumber', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Company registration number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              VAT Number
            </label>
            <input
              type="text"
              value={formData.vatNumber || ''}
              onChange={(e) => onChange('vatNumber', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="VAT registration number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Industry
            </label>
            <input
              type="text"
              value={formData.industry || ''}
              onChange={(e) => onChange('industry', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Contact Person <span className="text-error-500">*</span>
            </label>
            <input
              type="text"
              value={formData.contactPerson}
              onChange={(e) => onChange('contactPerson', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Email <span className="text-error-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => onChange('email', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Website
            </label>
            <input
              type="url"
              value={formData.website || ''}
              onChange={(e) => onChange('website', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="https://example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Phone <span className="text-error-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => onChange('phone', e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
          </div>
        </div>
      </div>
    </div>
  );
}