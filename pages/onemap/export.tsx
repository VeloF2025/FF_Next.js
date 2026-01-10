import { Download, FileText, FileJson, FileSpreadsheet } from 'lucide-react';
import { AppLayout } from '../../src/components/layout/AppLayout';

export default function OneMapExportPage() {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Export Data</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Export geographic data to various formats</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer">
            <FileJson className="h-8 w-8 text-blue-500 mb-3" />
            <h3 className="font-semibold text-[var(--ff-text-primary)] mb-2">GeoJSON</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">Standard geographic data format</p>
            <button className="flex items-center text-blue-400 hover:text-blue-300">
              <Download className="h-4 w-4 mr-1" />
              Export
            </button>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer">
            <FileText className="h-8 w-8 text-green-500 mb-3" />
            <h3 className="font-semibold text-[var(--ff-text-primary)] mb-2">KML</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">Google Earth compatible format</p>
            <button className="flex items-center text-blue-400 hover:text-blue-300">
              <Download className="h-4 w-4 mr-1" />
              Export
            </button>
          </div>

          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer">
            <FileSpreadsheet className="h-8 w-8 text-purple-500 mb-3" />
            <h3 className="font-semibold text-[var(--ff-text-primary)] mb-2">CSV/Excel</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">Spreadsheet format with coordinates</p>
            <button className="flex items-center text-blue-400 hover:text-blue-300">
              <Download className="h-4 w-4 mr-1" />
              Export
            </button>
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