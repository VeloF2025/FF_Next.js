import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import StockManagement from '../../../src/modules/procurement/stock/StockManagement';
import type { StockItem } from '../../../src/types/procurement/stock.types';

interface StockPageProps {
  projectId?: string;
  projectName?: string;
  initialData?: StockItem[];
}

export default function StockPage({ projectId, projectName, initialData = [] }: StockPageProps) {
  const router = useRouter();
  const [stockItems, setStockItems] = useState<StockItem[]>(initialData);
  const [isLoading, setIsLoading] = useState(!initialData.length);

  useEffect(() => {
    if (!initialData.length) {
      loadStockData();
    }
  }, [projectId]);

  const loadStockData = async () => {
    setIsLoading(true);
    try {
      const url = projectId 
        ? `/api/procurement/stock?projectId=${projectId}`
        : '/api/procurement/stock';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load stock data');
      const data = await response.json();
      setStockItems(data.items || []);
    } catch (error) {
      console.error('Error loading stock data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddStock = () => {
    router.push('/procurement/stock/add');
  };

  const handleTransferStock = () => {
    router.push('/procurement/stock/transfer');
  };

  const handleViewMovements = () => {
    router.push('/procurement/stock/movements');
  };

  return (
    <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Stock Management</h1>
          {projectName && (
            <p className="mt-2 text-[var(--ff-text-secondary)]">Project: {projectName}</p>
          )}
        </div>

        <div className="mb-6 flex gap-4">
          <button
            onClick={handleAddStock}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add Stock
          </button>
          <button
            onClick={handleTransferStock}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            Transfer Stock
          </button>
          <button
            onClick={handleViewMovements}
            className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md hover:bg-[var(--ff-bg-hover)]"
          >
            View Movements
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-[var(--ff-text-secondary)]">Loading stock data...</div>
          </div>
        ) : (
          <StockManagement
            projectId={projectId}
            stockItems={stockItems}
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
  
  return {
    props: {
      projectId: projectId || null,
      projectName: projectName || null,
      initialData: []
    }
  };
};