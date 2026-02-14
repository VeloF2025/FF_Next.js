/**
 * Client Service Types and Tags Component
 */

import { Client } from '@/types/client.types';

interface ClientServiceTagsProps {
  client: Client;
}

export function ClientServiceTags({ client }: ClientServiceTagsProps) {
  return (
    <div className="space-y-6">
      {/* Service Types */}
      {client.serviceTypes && client.serviceTypes.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Service Types</h2>
          <div className="flex flex-wrap gap-2">
            {client.serviceTypes.map((service: string) => (
              <span
                key={service}
                className="inline-flex items-center px-3 py-1 text-sm font-medium bg-blue-100 text-blue-800 rounded-full"
              >
                {service.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {client.tags && client.tags.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {client.tags.map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center px-3 py-1 text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}