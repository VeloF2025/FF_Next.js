import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import BOQList from '../../../src/components/procurement/boq/BOQList';
import type { BOQItem } from '../../../src/types/procurement/boq.types';

interface BOQPageProps {
  projectId?: string;
  projectName?: string;
  initialData?: BOQItem[];
}

export default function BOQPage({ projectId, projectName, initialData = [] }: BOQPageProps) {
  const router = useRouter();
  const [boqItems, setBoqItems] = useState<BOQItem[]>(initialData);
  const [isLoading, setIsLoading] = useState(!initialData.length);

  useEffect(() => {
    if (!initialData.length) {
      loadBOQData();
    }
  }, [projectId]);

  const loadBOQData = async () => {
    setIsLoading(true);
    try {
      const url = projectId 
        ? `/api/procurement/boq?projectId=${projectId}`
        : '/api/procurement/boq';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load BOQ data');
      const data = await response.json();
      setBoqItems(data.items || []);
    } catch (error) {
      console.error('Error loading BOQ data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBOQ = () => {
    router.push('/procurement/boq/new');
  };


  return (
    <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Bill of Quantities</h1>
          {projectName && (
            <p className="mt-2 text-[var(--ff-text-secondary)]">Project: {projectName}</p>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-[var(--ff-text-secondary)]">Loading BOQ data...</div>
          </div>
        ) : (
          <BOQList
            onCreateBOQ={handleCreateBOQ}
            className="mt-6"
          />
        )}
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;
  const projectName = query.projectName as string | undefined;
  
  // Optionally fetch initial data on the server side
  const initialData: BOQItem[] = [];
  
  try {
    // You can fetch initial data here if needed
    // const response = await fetch(`${process.env.API_URL}/api/procurement/boq`);
    // initialData = await response.json();
  } catch (error) {
    console.error('Error fetching initial BOQ data:', error);
  }
  
  return {
    props: {
      projectId: projectId || null,
      projectName: projectName || null,
      initialData
    }
  };
};