import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, AlertCircle } from 'lucide-react';
import { useProjectForm } from '@/hooks/useProjects';
import { useClientSelection } from '@/hooks/useClients';
import { useProjectManagerSelection } from '@/hooks/useStaff';
import { ProjectFormData, ProjectStatus, ProjectType, Priority } from '@/types/project.types';
import { SOWUploadWizard } from '@/components/sow/SOWUploadWizard';
import { safeToISOString } from '@/src/utils/dateHelpers';

// Import form sections
import { ProjectBasicInfo } from './forms/ProjectBasicInfo';
import { ProjectClientInfo } from './forms/ProjectClientInfo';
import { ProjectDetailsSection } from './forms/ProjectDetailsSection';
import { ProjectScheduleBudget } from './forms/ProjectScheduleBudget';
import { log } from '@/lib/logger';

export function ProjectForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  const { project, isLoading, save, error } = useProjectForm(id);
  const { clients, isLoading: isClientsLoading } = useClientSelection();
  const { isLoading: isManagersLoading, getAvailableProjectManagers } = useProjectManagerSelection();

  const [formData, setFormData] = useState<ProjectFormData>({
    code: '',
    name: '',
    description: '',
    clientId: '',
    location: '',
    projectType: ProjectType.FIBRE,
    priority: Priority.MEDIUM,
    status: ProjectStatus.PLANNING,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
    projectManagerId: '',
    budget: 0,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSOWWizard, setShowSOWWizard] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (project) {
      setFormData({
        code: project.code,
        name: project.name,
        description: project.description || '',
        clientId: project.clientId || '',
        location: project.location || '',
        projectType: project.projectType,
        priority: project.priority,
        status: project.status,
        startDate: safeToISOString(project.startDate),
        endDate: safeToISOString(project.endDate),
        projectManagerId: project.projectManagerId || '',
        budget: project.budget || 0,
      });
    }
  }, [project]);

  const handleInputChange = (field: keyof ProjectFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await save(formData);
      
      if (result && !isEditing) {
        // Project created successfully - show SOW wizard
        setCreatedProjectId(result);
        setIsSubmitting(false);
        setShowSOWWizard(true);
      } else {
        // Updated existing project, navigate back to list
        navigate('/app/projects');
      }
    } catch (error) {
      log.error('Failed to save project:', { data: error }, 'ProjectForm');
      setIsSubmitting(false);
    }
  };

  const handleSOWComplete = () => {
    setShowSOWWizard(false);
    // Navigate to the project detail page
    if (createdProjectId) {
      navigate(`/app/projects/${createdProjectId}`);
    } else {
      navigate('/app/projects');
    }
  };

  const handleSOWCancel = () => {
    setShowSOWWizard(false);
    // Still navigate to project detail, just skip SOW upload
    if (createdProjectId) {
      navigate(`/app/projects/${createdProjectId}`);
    } else {
      navigate('/app/projects');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/app/projects')}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {isEditing ? 'Edit Project' : 'Create New Project'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isEditing 
              ? 'Update project information and settings' 
              : 'Set up a new fiber optic project'
            }
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <span className="text-red-800">{error.message}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Project Information */}
        <ProjectBasicInfo 
          formData={formData}
          onInputChange={handleInputChange}
        />

        {/* Client Information */}
        <ProjectClientInfo
          formData={formData}
          onInputChange={handleInputChange}
          clients={clients}
          isClientsLoading={isClientsLoading}
        />

        {/* Project Details */}
        <ProjectDetailsSection
          formData={formData}
          onInputChange={handleInputChange}
        />

        {/* Schedule & Budget */}
        <ProjectScheduleBudget
          formData={formData}
          onInputChange={handleInputChange}
          managers={getAvailableProjectManagers()}
          isManagersLoading={isManagersLoading}
        />

        {/* Form Actions */}
        <div className="bg-card rounded-lg shadow-sm border border-border">
          <div className="px-6 py-4 bg-background border-t border-border rounded-b-lg">
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={() => navigate('/app/projects')}
                className="px-6 py-2 text-muted-foreground border border-border rounded-lg hover:bg-background transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    {isEditing ? 'Updating...' : 'Creating...'}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {isEditing ? 'Update Project' : 'Create Project'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* SOW Upload Wizard */}
      {showSOWWizard && createdProjectId && (
        <SOWUploadWizard
          projectId={createdProjectId}
          projectName={formData.name}
          onComplete={handleSOWComplete}
          onCancel={handleSOWCancel}
        />
      )}

    </div>
  );
}