import { Search, Filter } from 'lucide-react';
import { AppLayout } from '../../src/components/layout/AppLayout';

export default function OneMapSearchPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Search & Filter</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Advanced search and filtering capabilities</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-[var(--ff-text-tertiary)]" />
                  <input
                    type="text"
                    placeholder="Search locations, addresses, or coordinates..."
                    className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Search
              </button>
            </div>

            <div className="border-t border-[var(--ff-border-light)] pt-4">
              <div className="flex items-center mb-3">
                <Filter className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-2" />
                <h3 className="font-medium text-[var(--ff-text-primary)]">Filters</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Type</label>
                  <select className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>All Types</option>
                    <option>Poles</option>
                    <option>Cables</option>
                    <option>Splices</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Status</label>
                  <select className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>All Status</option>
                    <option>Active</option>
                    <option>Planned</option>
                    <option>Completed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">Date Range</label>
                  <select className="w-full px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>All Time</option>
                    <option>Last 7 Days</option>
                    <option>Last 30 Days</option>
                    <option>Last Year</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--ff-border-light)] pt-4">
              <p className="text-sm text-[var(--ff-text-secondary)] text-center">No search results to display</p>
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