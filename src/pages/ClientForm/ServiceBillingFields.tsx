import { ClientFormData, ServiceType, PaymentTerms } from '@/types/client.types';

interface ServiceBillingFieldsProps {
  formData: ClientFormData;
  onChange: (field: keyof ClientFormData, value: unknown) => void;
}

export function ServiceBillingFields({ formData, onChange }: ServiceBillingFieldsProps) {
  return (
    <>
      {/* Service Information */}
      <div>
        <h3 className="text-lg font-semibold text-neutral-900 mb-4">Service Information</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Services Required
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.values(ServiceType).map((service) => (
                <label key={service} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.serviceTypes?.includes(service)}
                    onChange={(e) => {
                      const services = formData.serviceTypes || [];
                      if (e.target.checked) {
                        onChange('serviceTypes', [...services, service]);
                      } else {
                        onChange('serviceTypes', services.filter(s => s !== service));
                      }
                    }}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-neutral-300 rounded"
                  />
                  <span className="ml-2 text-sm text-neutral-700">{service}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Special Requirements
            </label>
            <textarea
              value={formData.specialRequirements || ''}
              onChange={(e) => onChange('specialRequirements', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Any special requirements or notes..."
            />
          </div>
        </div>
      </div>

      {/* Billing Information */}
      <div>
        <h3 className="text-lg font-semibold text-neutral-900 mb-4">Billing Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Payment Terms
            </label>
            <select
              value={formData.paymentTerms}
              onChange={(e) => onChange('paymentTerms', e.target.value as PaymentTerms)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Select Payment Terms</option>
              <option value={PaymentTerms.NET_30}>Net 30</option>
              <option value={PaymentTerms.NET_60}>Net 60</option>
              <option value={PaymentTerms.NET_90}>Net 90</option>
              <option value={PaymentTerms.ON_DELIVERY}>On Delivery</option>
              <option value={PaymentTerms.PREPAID}>Prepaid</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Credit Limit
            </label>
            <input
              type="number"
              value={formData.creditLimit}
              onChange={(e) => onChange('creditLimit', parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Tax Exempt
            </label>
            <select
              value={formData.taxExempt ? 'yes' : 'no'}
              onChange={(e) => onChange('taxExempt', e.target.value === 'yes')}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Requires PO
            </label>
            <select
              value={formData.requiresPO ? 'yes' : 'no'}
              onChange={(e) => onChange('requiresPO', e.target.value === 'yes')}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Auto-Approve Orders
            </label>
            <select
              value={formData.autoApproveOrders ? 'yes' : 'no'}
              onChange={(e) => onChange('autoApproveOrders', e.target.value === 'yes')}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Allow Backorders
            </label>
            <select
              value={formData.allowBackorders ? 'yes' : 'no'}
              onChange={(e) => onChange('allowBackorders', e.target.value === 'yes')}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes || ''}
            onChange={(e) => onChange('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="Additional notes..."
          />
        </div>
      </div>
    </>
  );
}