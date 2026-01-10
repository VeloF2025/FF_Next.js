import { Layers } from 'lucide-react';
import { AppLayout } from '../../src/components/layout/AppLayout';

export default function OneMapLayersPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Map Layers</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Manage and configure map layers</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center">
                <input type="checkbox" className="mr-3" defaultChecked />
                <Layers className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">Base Map</p>
                  <p className="text-sm text-[var(--ff-text-tertiary)]">Default map layer</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center">
                <input type="checkbox" className="mr-3" />
                <Layers className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">Fiber Routes</p>
                  <p className="text-sm text-[var(--ff-text-tertiary)]">Fiber cable paths</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border border-[var(--ff-border-light)] rounded-lg">
              <div className="flex items-center">
                <input type="checkbox" className="mr-3" />
                <Layers className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">Poles</p>
                  <p className="text-sm text-[var(--ff-text-tertiary)]">Pole locations</p>
                </div>
              </div>
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