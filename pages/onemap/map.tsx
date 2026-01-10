import { Map } from 'lucide-react';
import { AppLayout } from '../../src/components/layout/AppLayout';

export default function OneMapMapPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Map View</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Interactive geographic visualization</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 h-[600px]">
          <div className="flex items-center justify-center h-full bg-[var(--ff-bg-tertiary)] rounded">
            <div className="text-center">
              <Map className="mx-auto h-12 w-12 text-[var(--ff-text-tertiary)]" />
              <p className="mt-2 text-sm text-[var(--ff-text-secondary)]">Map visualization will be displayed here</p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};