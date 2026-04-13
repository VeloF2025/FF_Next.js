import { ClientFormData } from '@/types/client.types';

interface ContactFieldsProps {
  formData: ClientFormData;
  onChange: (field: keyof ClientFormData, value: unknown) => void;
}

export function ContactFields({ formData, onChange }: ContactFieldsProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-neutral-900 mb-4">Contact Information</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            Alternative Email
          </label>
          <input
            type="email"
            value={formData.alternativeEmail || ''}
            onChange={(e) => onChange('alternativeEmail', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Alternative Phone
          </label>
          <input
            type="tel"
            value={formData.alternativePhone || ''}
            onChange={(e) => onChange('alternativePhone', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Preferred Contact Method
          </label>
          <select
            value={formData.preferredContactMethod}
            onChange={(e) => onChange('preferredContactMethod', e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="EMAIL">Email</option>
            <option value="PHONE">Phone</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
      </div>
    </div>
  );
}