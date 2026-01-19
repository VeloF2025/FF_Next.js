import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import RFQList from '../../../src/components/procurement/rfq/RFQList';

interface RFQ {
  id: string;
  title: string;
  description?: string;
  status: 'draft' | 'active' | 'closed' | 'expired';
  createdAt: string;
  dueDate?: string;
  projectId?: string;
  supplierCount?: number;
  responseCount?: number;
}

interface RFQPageProps {
  projectId?: string;
  projectName?: string;
  initialData?: RFQ[];
}

export default function RFQPage({ projectId, projectName, initialData = [] }: RFQPageProps) {
  const router = useRouter();
  const [rfqs, setRfqs] = useState<RFQ[]>(initialData);
  const [isLoading, setIsLoading] = useState(!initialData.length);

  useEffect(() => {
    if (!initialData.length) {
      loadRFQData();
    }
  }, [projectId]);

  const loadRFQData = async () => {
    setIsLoading(true);
    try {
      const url = projectId
        ? `/api/procurement/rfq?projectId=${projectId}`
        : '/api/procurement/rfq';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load RFQ data');
      const result = await response.json();
      // API wraps response in { success, data: { rfqs, total } }
      const rfqData = result.data?.rfqs || result.rfqs || [];
      setRfqs(rfqData);
    } catch (error) {
      console.error('Error loading RFQ data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateRFQ = () => {
    router.push('/procurement/rfq/new');
  };

  const handleEditRFQ = (id: string) => {
    router.push(`/procurement/rfq/${id}/edit`);
  };

  const handleViewRFQ = (id: string) => {
    router.push(`/procurement/rfq/${id}`);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-[var(--ff-text-secondary)]">Loading RFQs...</div>
          </div>
        ) : (
          <RFQList
            rfqs={rfqs}
            onCreateRFQ={handleCreateRFQ}
            onView={handleViewRFQ}
            onEdit={handleEditRFQ}
          />
        )}
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;
  const projectName = query.projectName as string | undefined;
  
  return {
    props: {
      projectId: projectId || null,
      projectName: projectName || null,
      initialData: []
    }
  };
};