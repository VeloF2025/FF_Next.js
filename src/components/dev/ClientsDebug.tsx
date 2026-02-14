import { useEffect, useState } from 'react';
import { sql } from '@/lib/neon';

interface Client {
  id: string;
  name?: string;
  contact_person?: string;
  email?: string;
  [key: string]: unknown;
}

export function ClientsDebug() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchClients() {
      try {
        // Direct SQL query to test connection
        const result = await sql`
          SELECT * FROM clients
          ORDER BY name ASC
          LIMIT 10
        `;
        
        setClients(result as Client[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchClients();
  }, []);

  if (loading) return <div>Loading clients from Neon...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Clients Debug (Neon Database)</h2>
      <p className="mb-2">Total clients found: {clients.length}</p>
      
      {clients.length === 0 ? (
        <div className="bg-yellow-100 p-4 rounded">
          No clients found in Neon. Please check:
          <ul className="list-disc ml-5 mt-2">
            <li>Neon database connection is configured</li>
            <li>The &apos;clients&apos; table exists</li>
            <li>There are records in the clients table</li>
            <li>Check browser console for errors</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map(client => (
            <div key={client.id} className="bg-secondary p-3 rounded">
              <div className="font-semibold">ID: {client.id}</div>
              <div className="text-sm text-muted-foreground">
                Name: {client.name || 'No name'}
              </div>
              <div className="text-sm text-muted-foreground">
                Contact: {client.contact_person || 'No contact'}
              </div>
              <div className="text-sm text-muted-foreground">
                Email: {client.email || 'No email'}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                <pre>{JSON.stringify(client, null, 2)}</pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}