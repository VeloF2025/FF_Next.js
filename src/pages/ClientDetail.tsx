import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit, Building } from 'lucide-react';
import { useClient, useDeleteClient } from '@/hooks/useClients';
import { notificationService } from '@/services/core/NotificationService';

// Import split components
import { ClientInfoSection } from './client/ClientInfoSection';
import { ClientFinancialSection } from './client/ClientFinancialSection';
import { ClientProjectStats } from './client/ClientProjectStats';
import { ClientServiceTags } from './client/ClientServiceTags';
import { ClientAddressNotes } from './client/ClientAddressNotes';
import { getStatusColor, getPriorityColor, getCreditRatingColor, formatCurrency } from './client/ClientHelpers';

export function ClientDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading, error } = useClient(id || '');
  const deleteMutation = useDeleteClient();

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this client?')) return;
    
    try {
      await deleteMutation.mutateAsync(id!);
      notificationService.success('Client deleted');
      navigate('/clients');
    } catch (error) {
      notificationService.error('Failed to delete client');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">Client not found</p>
        </div>
      </div>
    );
  }


  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => navigate('/clients')}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Client List
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Building className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{client.name}</h1>
                <p className="text-sm text-gray-500">{client.contactPerson}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/clients/${id}/edit`)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status and Priority Badges */}
          <div className="flex gap-2">
            <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${getStatusColor(client.status)}`}>
              {client.status.replace('_', ' ').toUpperCase()}
            </span>
            <span className={`inline-flex px-3 py-1 text-sm font-medium rounded-full ${getPriorityColor(client.priority)}`}>
              {client.priority.toUpperCase()} PRIORITY
            </span>
            <span className="inline-flex px-3 py-1 text-sm font-medium rounded-full bg-gray-100 text-gray-800">
              {client.category.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {/* Contact and Company Information */}
          <ClientInfoSection 
            client={client} 
            getStatusColor={getStatusColor}
            getPriorityColor={getPriorityColor}
          />

          {/* Financial Information */}
          <ClientFinancialSection 
            client={client}
            getCreditRatingColor={getCreditRatingColor}
            formatCurrency={formatCurrency}
          />

          {/* Project Statistics */}
          <ClientProjectStats client={client} formatCurrency={formatCurrency} />

          {/* Service Types and Tags */}
          <ClientServiceTags client={client} />

          {/* Address, Notes, and Timestamps */}
          <ClientAddressNotes client={client} />
        </div>
      </div>
    </div>
  );
}