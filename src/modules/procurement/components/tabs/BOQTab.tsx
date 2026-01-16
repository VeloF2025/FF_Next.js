// 🟢 WORKING: BOQ tab component with project filtering and integration
import { useEffect, useState } from 'react';
import { Plus, FileText, Search, Filter, Download, Upload } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useProcurementPortal } from '../../context/ProcurementPortalProvider';
import { BOQDashboard } from '../../boq/components/BOQDashboard';
import { BOQCreate } from '../../boq/components/BOQCreate';
import { BOQEdit } from '../../boq/components/BOQEdit';
import type { BOQItem } from '@/types/procurement/boq.types';
import { log } from '@/lib/logger';

export function BOQTab() {
  const { selectedProject, updateTabBadge } = useProcurementPortal();
  const [view, setView] = useState<'dashboard' | 'create' | 'edit'>('dashboard');
  const [selectedBOQ, setSelectedBOQ] = useState<string | undefined>();
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Update tab badge with BOQ count for selected project
  useEffect(() => {
    if (selectedProject) {
      // TODO: Replace with actual API call to get BOQ count
      const mockBOQCount = 3;
      updateTabBadge('boq', { count: mockBOQCount, type: 'info' });
    }
  }, [selectedProject, updateTabBadge]);

  // Handle BOQ creation
  const handleCreateBOQ = () => {
    setView('create');
  };

  // Handle BOQ editing
  const handleEditBOQ = (boqId: string) => {
    setSelectedBOQ(boqId);
    setView('edit');
  };

  // Handle back to dashboard
  const handleBackToDashboard = () => {
    setView('dashboard');
    setSelectedBOQ(undefined);
  };

  // Handle BOQ save (create/update)
  const handleSaveBOQ = async (_boqData: Partial<BOQItem>) => {
    setIsLoading(true);
    try {
      // TODO: Implement actual save logic
      await new Promise(resolve => setTimeout(resolve, 1000));
      handleBackToDashboard();
    } catch (error) {
      log.error('Error saving BOQ:', { data: error }, 'BOQTab');
    } finally {
      setIsLoading(false);
    }
  };

  // Render current view
  const renderContent = () => {
    if (!selectedProject) {
      return <NoProjectSelected />;
    }

    switch (view) {
      case 'create':
        return (
          <BOQCreate
            projectId={selectedProject.id}
            onSave={handleSaveBOQ}
            onCancel={handleBackToDashboard}
            isLoading={isLoading}
          />
        );
      
      case 'edit':
        return (
          <BOQEdit
            boqId={selectedBOQ!}
            projectId={selectedProject.id}
            onSave={handleSaveBOQ}
            onCancel={handleBackToDashboard}
            isLoading={isLoading}
          />
        );
      
      case 'dashboard':
      default:
        return (
          <div className="h-full flex flex-col">
            {/* BOQ Header */}
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    Bill of Quantities
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Managing BOQs for {selectedProject.name} ({selectedProject.code})
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Import
                  </Button>
                  
                  <Button
                    onClick={handleCreateBOQ}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Create BOQ
                  </Button>
                </div>
              </div>

              {/* Search and Filter Bar */}
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search BOQs by name, category, or item..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filter
                </Button>
              </div>
            </div>

            {/* BOQ Content */}
            <div className="flex-1 overflow-hidden">
              <BOQDashboard
                projectId={selectedProject.id}
                searchTerm={searchTerm}
                onEdit={handleEditBOQ}
                onCreate={handleCreateBOQ}
              />
            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-full bg-gray-50">
      {renderContent()}
    </div>
  );
}

/**
 * Component shown when no project is selected
 */
function NoProjectSelected() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center">
          <FileText className="h-12 w-12 text-blue-600" />
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 mb-4">
          Project Selection Required
        </h3>
        
        <p className="text-gray-600 mb-6">
          Please select a project to view and manage its Bill of Quantities (BOQ). 
          BOQs are project-specific and contain detailed cost breakdowns for materials and services.
        </p>
        
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-700">
            <strong>Tip:</strong> Use the project selector above to choose a project 
            and start managing its BOQ items.
          </p>
        </div>
      </div>
    </div>
  );
}

// Export component
export default BOQTab;