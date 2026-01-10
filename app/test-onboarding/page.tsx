'use client';

import { useState, useEffect } from 'react';

export default function TestOnboardingPage() {
  const [stages, setStages] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const contractorId = 'ebb08cc4-d23e-4605-9f57-1eb3784d57ee';

  useEffect(() => {
    fetch(`/api/contractors/${contractorId}/onboarding/stages`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        console.log('API Response:', data);
        setStages(data);
        setLoading(false);
      })
      .catch(e => {
        console.error('Error:', e);
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Contractor Onboarding Test</h1>
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="mt-2">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Contractor Onboarding Test</h1>
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <p className="text-red-800 font-medium">Error</p>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Contractor Onboarding Test</h1>
      <div className="bg-gray-50 border border-gray-200 p-4 rounded">
        <pre className="text-sm overflow-auto">
          {JSON.stringify(stages, null, 2)}
        </pre>
      </div>
    </div>
  );
}
