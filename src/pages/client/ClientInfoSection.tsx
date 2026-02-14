/**
 * Client Information Section Component
 */

import { Mail, Phone, Globe, Building } from 'lucide-react';
import { Client } from '@/types/client.types';

interface ClientInfoSectionProps {
  client: Client;
  getStatusColor: (status: string) => string;
  getPriorityColor: (priority: string) => string;
}

export function ClientInfoSection({ client, getStatusColor, getPriorityColor }: ClientInfoSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Basic Information</h2>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Organization Type</label>
            <p className="mt-1 text-gray-900 dark:text-gray-100">{client.organizationType || 'Not specified'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Industry</label>
            <p className="mt-1 text-gray-900 dark:text-gray-100">{client.industry || 'Not specified'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</label>
            <div className="mt-1">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(client.status)}`}>
                {client.status}
              </span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Priority</label>
            <div className="mt-1">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(client.priority)}`}>
                {client.priority}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Contact Information</h3>
          <div className="space-y-3">
            <div className="flex items-center text-sm">
              <Building className="h-4 w-4 text-gray-400 mr-2" />
              <span className="text-gray-900 dark:text-gray-100">{client.address || 'No address provided'}</span>
            </div>
            <div className="flex items-center text-sm">
              <Mail className="h-4 w-4 text-gray-400 mr-2" />
              <a href={`mailto:${client.email}`} className="text-blue-600 hover:underline">
                {client.email}
              </a>
            </div>
            <div className="flex items-center text-sm">
              <Phone className="h-4 w-4 text-gray-400 mr-2" />
              <a href={`tel:${client.phone}`} className="text-blue-600 hover:underline">
                {client.phone}
              </a>
            </div>
            {client.website && (
              <div className="flex items-center text-sm">
                <Globe className="h-4 w-4 text-gray-400 mr-2" />
                <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {client.website}
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Contact Person</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</label>
              <p className="mt-1 text-gray-900 dark:text-gray-100">{client.contactPerson}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Position</label>
              <p className="mt-1 text-gray-900 dark:text-gray-100">{client.contactPosition || 'Not specified'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}