/**
 * Project Client Information Form Section
 */

import { ProjectFormData } from '@/types/project.types';
import { ClientDropdownOption } from '@/types/client.types';

interface ProjectClientInfoProps {
  formData: ProjectFormData;
  onInputChange: (field: keyof ProjectFormData, value: ProjectFormData[keyof ProjectFormData]) => void;
  clients: ClientDropdownOption[];
  isClientsLoading: boolean;
}

export function ProjectClientInfo({ 
  formData, 
  onInputChange, 
  clients, 
  isClientsLoading 
}: ProjectClientInfoProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border">
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Client Information</h2>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Client Organization *
            </label>
            <select
              value={formData.clientId}
              onChange={(e) => onInputChange('clientId', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={isClientsLoading}
            >
              <option value="">
                {isClientsLoading ? 'Loading clients...' : 'Select a client'}
              </option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.contactPerson})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose the client organization for this project
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}