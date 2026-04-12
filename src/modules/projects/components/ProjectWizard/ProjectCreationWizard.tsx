'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { CheckCircle, FileSpreadsheet, ArrowRight, Folder, Database } from 'lucide-react';
import { useActiveClients } from '@/hooks/useClients';
import { useProjectManagers } from '@/hooks/useStaff';
import { useCreateProject } from '@/hooks/useProjects';
import { WizardHeader } from './WizardHeader';
import { WizardNavigation } from './WizardNavigation';
import { BasicInfoStep } from './steps/BasicInfoStep';
import { ProjectDetailsStep } from './steps/ProjectDetailsStep';
// import { SOWUploadStep } from './steps/SOWUploadStep';
import { ReviewStep } from './steps/ReviewStep';
import type { FormData } from './types';
import type { ProjectFormData } from '@/types/project/form.types';
import { ProjectPriority } from '../../types/project.types';
import type { StaffDropdownOption } from '@/types/staff/form.types';

interface ActiveClient {
  id?: string;
  company_name?: string;
  companyName?: string;
}
import { log } from '@/lib/logger';
import { notificationService } from '@/services/core/NotificationService';

export function ProjectCreationWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string>();

  const form = useForm<FormData>({
    defaultValues: {
      priority: ProjectPriority.MEDIUM,
    }
  });

  // Fetch clients and project managers from Neon database
  const { data: clients = [], isLoading: isClientsLoading } = useActiveClients();
  const { data: projectManagers = [], isLoading: isProjectManagersLoading } = useProjectManagers();
  const createProject = useCreateProject();

  const handleNext = () => {
    const formData = form.getValues();
    
    // Validate step 0 (Basic Info)
    if (currentStep === 0) {
      if (!formData.name) {
        notificationService.warning('Please enter a project name');
        return;
      }
      if (!formData.clientId) {
        notificationService.warning('Please select a client');
        return;
      }
    }

    // Validate step 1 (Project Details)
    if (currentStep === 1) {
      if (!formData.projectManagerId) {
        notificationService.warning('Please select a project manager');
        return;
      }
    }
    
    if (currentStep < 2) { // Only go to review step (step 2)
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    try {
      const formData = form.getValues();
      
      // Validate required fields
      if (!formData.clientId) {
        notificationService.warning('Please select a client');
        return;
      }

      if (!formData.name) {
        notificationService.warning('Please enter a project name');
        return;
      }
      
      // Calculate end date if not set
      const startDate = formData.startDate;
      let endDate = formData.endDate;
      
      if (!endDate && startDate && formData.durationMonths) {
        const start = new Date(startDate);
        start.setMonth(start.getMonth() + formData.durationMonths);
        endDate = start.toISOString().split('T')[0] ?? '';
      }

      // Map form data to project format (service will convert to snake_case)
      const projectData: Record<string, unknown> = {
        name: formData.name,
        projectName: formData.name, // Some parts expect projectName
        projectCode: `PRJ-${Date.now()}`, // Generate a simple project code
        clientId: formData.clientId,
        description: formData.description || formData.notes || '',
        projectType: 'installation', // Default type
        status: 'planning',
        priority: formData.priority,
        startDate: startDate,
        endDate: endDate || startDate, // Use start date if end date is not available
        budget: formData.budget?.totalBudget || 0,
        projectManager: formData.projectManagerId,
        location: formData.location || null // Don't stringify, send as object or null
      };

      log.debug('Submitting project data', { projectData, formData }, 'ProjectCreationWizard');
      const result = await createProject.mutateAsync(projectData as unknown as ProjectFormData);
      log.info('Project created successfully:', { data: result }, 'ProjectCreationWizard');

      // Store the created project ID and show success
      setCreatedProjectId(result);
      setShowSuccess(true);
    } catch (error) {
      // Error logging is already handled below with proper logging
      log.error('Failed to create project:', { data: error }, 'ProjectCreationWizard');
      notificationService.error(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFinish = () => {
    router.push('/projects');
  };

  const selectedClient = (clients as ActiveClient[])?.find((c) => c.id === form.watch('clientId'));
  const selectedProjectManager = (projectManagers as StaffDropdownOption[])?.find((pm) => pm.id === form.watch('projectManagerId'));

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <BasicInfoStep
            form={form}
            clients={(clients as ActiveClient[])?.map((c) => ({ id: c.id!, name: c.company_name || c.companyName || '' })) || []}
            isClientsLoading={isClientsLoading}
          />
        );
      case 1:
        return (
          <ProjectDetailsStep
            form={form}
            projectManagers={projectManagers}
            isProjectManagersLoading={isProjectManagersLoading}
          />
        );
      case 2:
        return (
          <ReviewStep
            form={form}
            clientName={selectedClient?.company_name || selectedClient?.companyName || 'Unknown'}
            projectManagerName={selectedProjectManager?.name || 'Unassigned'}
          />
        );
      default:
        return null;
    }
  };

  // Show success message if project was created
  if (showSuccess) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-[var(--ff-bg-secondary)] shadow-lg rounded-lg p-8 text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>

          <h2 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-2">
            Project Created Successfully!
          </h2>

          <p className="text-[var(--ff-text-secondary)] mb-8">
            Your project has been created. You can now import the Statement of Work (SOW)
            to populate project specifications.
          </p>
          
          <div className="space-y-4">
            <Link
              href={`/sow-management?projectId=${createdProjectId}`}
              className="inline-flex items-center justify-center w-full px-6 py-3 text-base font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <FileSpreadsheet className="h-5 w-5 mr-2" />
              Import SOW from Excel
            </Link>
            
            <Link
              href={`/projects/${createdProjectId}?tab=documents`}
              className="inline-flex items-center justify-center w-full px-6 py-3 text-base font-medium text-emerald-600 bg-[var(--ff-bg-secondary)] border border-emerald-600 rounded-md hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
            >
              <Database className="h-5 w-5 mr-2" />
              Import from QField GeoPackage
            </Link>

            <Link
              href={`/projects/${createdProjectId}`}
              className="inline-flex items-center justify-center w-full px-6 py-3 text-base font-medium text-blue-600 bg-[var(--ff-bg-secondary)] border border-blue-600 rounded-md hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <Folder className="h-5 w-5 mr-2" />
              View Project Details
            </Link>

            <button
              onClick={() => router.push('/projects')}
              className="inline-flex items-center justify-center w-full px-6 py-3 text-base font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md hover:bg-[var(--ff-bg-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Go to Projects List
              <ArrowRight className="h-5 w-5 ml-2" />
            </button>
          </div>

          <div className="mt-8 p-4 bg-blue-500/20 rounded-lg border border-blue-500/30">
            <p className="text-sm text-blue-400">
              <strong>Tip:</strong> Importing SOW data will automatically create poles, drops,
              and fiber specifications for your project, saving you time on manual data entry.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <WizardHeader currentStep={currentStep} />

      <form className="bg-[var(--ff-bg-secondary)] shadow-lg rounded-lg p-6">
        {renderStepContent()}

        <WizardNavigation
          currentStep={currentStep}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onSubmit={currentStep === 2 ? handleSubmit : handleFinish}
          isSubmitting={createProject.isPending}
          isLastStep={currentStep === 2}
        />
      </form>
    </div>
  );
}