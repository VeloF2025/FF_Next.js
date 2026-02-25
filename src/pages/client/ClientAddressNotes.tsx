/**
 * Client Address and Notes Component
 */

import { Client } from '@/types/client.types';
import { formatDisplayDateTime } from '@/utils/dateFormat';

interface ClientAddressNotesProps {
  client: Client;
}

export function ClientAddressNotes({ client }: ClientAddressNotesProps) {
  return (
    <div className="space-y-6">
      {/* Address */}
      {client.address && (
        <div>
          <h2 className="text-lg font-medium text-foreground mb-4">Address</h2>
          <div className="bg-background rounded-lg p-4">
            <p>{client.address}</p>
            <p>{client.city}, {client.province} {client.postalCode}</p>
            <p>{client.country}</p>
          </div>
        </div>
      )}

      {/* Notes */}
      {client.notes && (
        <div>
          <h2 className="text-lg font-medium text-foreground mb-4">Notes</h2>
          <div className="bg-yellow-50 rounded-lg p-4">
            <p className="text-muted-foreground whitespace-pre-wrap">{client.notes}</p>
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="pt-4 border-t border-border">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium">Created:</span>{' '}
            {formatDisplayDateTime(client.createdAt)}
          </div>
          <div>
            <span className="font-medium">Updated:</span>{' '}
            {formatDisplayDateTime(client.updatedAt)}
          </div>
          {client.lastContactDate && (
            <div>
              <span className="font-medium">Last Contact:</span>{' '}
              {formatDisplayDateTime(client.lastContactDate)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}