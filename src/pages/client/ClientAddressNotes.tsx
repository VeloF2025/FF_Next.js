/**
 * Client Address and Notes Component
 */

import { Client } from '@/types/client.types';
import { format } from 'date-fns';

interface ClientAddressNotesProps {
  client: Client;
}

export function ClientAddressNotes({ client }: ClientAddressNotesProps) {
  return (
    <div className="space-y-6">
      {/* Address */}
      {client.address && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Address</h2>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
            <p>{client.address}</p>
            <p>{client.city}, {client.province} {client.postalCode}</p>
            <p>{client.country}</p>
          </div>
        </div>
      )}

      {/* Notes */}
      {client.notes && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Notes</h2>
          <div className="bg-yellow-50 rounded-lg p-4">
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{client.notes}</p>
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-500 dark:text-gray-400">
          <div>
            <span className="font-medium">Created:</span>{' '}
            {client.createdAt?.toDate 
              ? format(client.createdAt.toDate(), 'dd MMM yyyy HH:mm')
              : 'N/A'}
          </div>
          <div>
            <span className="font-medium">Updated:</span>{' '}
            {client.updatedAt?.toDate 
              ? format(client.updatedAt.toDate(), 'dd MMM yyyy HH:mm')
              : 'N/A'}
          </div>
          {client.lastContactDate && (
            <div>
              <span className="font-medium">Last Contact:</span>{' '}
              {client.lastContactDate.toDate 
                ? format(client.lastContactDate.toDate(), 'dd MMM yyyy')
                : 'N/A'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}