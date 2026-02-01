import { Grid3x3 } from 'lucide-react';
import { AppLayout } from '../../src/components/layout/AppLayout';

export default function OneMapGridPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Data Grid</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Tabular view of geographic data</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Coordinates</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                <tr>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]" colSpan={5}>
                    <div className="flex items-center justify-center">
                      <Grid3x3 className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-2" />
                      <span>No data available</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
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