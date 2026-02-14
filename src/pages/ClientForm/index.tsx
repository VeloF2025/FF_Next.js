import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { ClientFormData } from '@/types/client.types';
import { useClient, useCreateClient, useUpdateClient } from '@/hooks/useClients';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ClientFormFields } from './ClientFormFields';
import { ContactFields } from './ContactFields';
import { AddressFields } from './AddressFields';
import { ServiceBillingFields } from './ServiceBillingFields';
import { log } from '@/lib/logger';

export function ClientForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  const { data: client, isLoading } = useClient(id || '');
  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();

  const [formData, setFormData] = useState<ClientFormData>({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: {
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    },
    billingAddress: {
      sameAsPhysical: true,
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    },
    registrationNumber: '',
    vatNumber: '',
    industry: '',
    website: '',
    alternativeEmail: '',
    alternativePhone: '',
    creditLimit: 0,
    paymentTerms: 'NET_30' as any,
    creditRating: 'GOOD' as any,
    status: 'ACTIVE' as any,
    category: 'STANDARD' as any,
    priority: 'MEDIUM' as any,
    preferredContactMethod: 'EMAIL' as any,
    communicationLanguage: 'en',
    timezone: 'UTC',
    notes: '',
    tags: [],
    serviceTypes: [],
    specialRequirements: '',
    taxExempt: false,
    autoApproveOrders: false,
    requiresPO: false,
    allowBackorders: false,
  });

  useEffect(() => {
    if (client && isEditing) {
      setFormData({
        name: client.name,
        contactPerson: client.contactPerson,
        email: client.email,
        phone: client.phone,
        address: {
          street: client.address,
          city: client.city,
          state: client.province,
          postalCode: client.postalCode,
          country: client.country,
        },
        billingAddress: client.billingAddress || {
          sameAsPhysical: true,
          street: '',
          city: '',
          state: '',
          postalCode: '',
          country: '',
        },
        registrationNumber: client.registrationNumber || '',
        vatNumber: client.vatNumber || '',
        industry: client.industry,
        website: client.website || '',
        alternativeEmail: client.alternativeEmail || '',
        alternativePhone: client.alternativePhone || '',
        creditLimit: client.creditLimit,
        paymentTerms: client.paymentTerms,
        creditRating: client.creditRating,
        status: client.status,
        category: client.category,
        priority: client.priority,
        accountManagerId: client.accountManagerId || '',
        salesRepresentativeId: client.salesRepresentativeId || '',
        preferredContactMethod: client.preferredContactMethod,
        communicationLanguage: client.communicationLanguage || 'en',
        timezone: client.timezone || 'UTC',
        notes: client.notes || '',
        tags: client.tags || [],
        serviceTypes: client.serviceTypes || [],
        specialRequirements: client.specialRequirements || '',
        taxExempt: client.taxExempt || false,
        requiresPO: client.requiresPO || false,
        autoApproveOrders: client.autoApproveOrders || false,
        allowBackorders: client.allowBackorders || false,
      });
    }
  }, [client, isEditing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: id!, data: formData });
      } else {
        await createMutation.mutateAsync(formData);
      }
      navigate('/clients');
    } catch (error) {
      log.error('Error saving client:', { data: error }, 'index');
    }
  };

  const handleInputChange = (field: keyof ClientFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => navigate('/clients')}
          className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-neutral-200">
        <div className="p-6 border-b border-neutral-200">
          <h2 className="text-2xl font-semibold text-neutral-900">
            {isEditing ? 'Edit Client' : 'New Client'}
          </h2>
          <p className="text-neutral-600 mt-1">
            {isEditing ? 'Update client information' : 'Add a new client to your system'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <ClientFormFields 
            formData={formData}
            onChange={handleInputChange}
          />
          
          <ContactFields
            formData={formData}
            onChange={handleInputChange}
          />
          
          <AddressFields
            formData={formData}
            onChange={handleInputChange}
          />
          
          <ServiceBillingFields
            formData={formData}
            onChange={handleInputChange}
          />

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-6 border-t border-neutral-200">
            <button
              type="button"
              onClick={() => navigate('/clients')}
              className="px-4 py-2 text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <>
                  <LoadingSpinner size="sm" className="text-white" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEditing ? 'Update Client' : 'Create Client'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}