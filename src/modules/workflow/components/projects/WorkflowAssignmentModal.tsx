// 🟢 WORKING: WorkflowAssignmentModal component - modal for assigning workflow templates to projects
import { useState, useEffect } from 'react';
import {
  X,
  Search,
  User,
  Users,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react';

import type {
  WorkflowTemplate,
  CreateProjectWorkflowRequest,
  Project,
  StaffMember
} from '../../types/workflow.types';
import { log } from '@/lib/logger';

interface WorkflowAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string | null;
  templates: WorkflowTemplate[];
  onAssign: (workflowData: CreateProjectWorkflowRequest) => void;
}

export function WorkflowAssignmentModal({
  isOpen,
  onClose,
  projectId,
  templates,
  onAssign
}: WorkflowAssignmentModalProps) {
  const [step, setStep] = useState<'project' | 'template' | 'details'>('project');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Data from APIs
  const [projects, setProjects] = useState<Project[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(false);

  // Form state
  const [workflowName, setWorkflowName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Fetch projects from real API
  useEffect(() => {
    if (isOpen && step === 'project') {
      setLoadingProjects(true);
      fetch('/api/projects')
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            setProjects(data.data.map((p: { id: string; project_name: string; description?: string; status?: string; start_date?: string; end_date?: string }) => ({
              id: p.id,
              name: p.project_name,
              description: p.description || '',
              status: p.status || 'active',
              startDate: p.start_date || '',
              endDate: p.end_date || ''
            })));
          }
        })
        .catch(err => log.error('WorkflowAssignmentModal', { action: 'fetchProjects', error: err }))
        .finally(() => setLoadingProjects(false));
    }
  }, [isOpen, step]);

  // Fetch staff from real API
  useEffect(() => {
    if (isOpen && step === 'details') {
      setLoadingStaff(true);
      fetch('/api/staff')
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            setStaffMembers(data.data.map((s: { id: string; first_name?: string; last_name?: string; email?: string; department?: string; position?: string }) => ({
              id: s.id,
              name: `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Unknown',
              email: s.email || '',
              department: s.department || '',
              position: s.position || ''
            })));
          }
        })
        .catch(err => log.error('WorkflowAssignmentModal', { action: 'fetchStaff', error: err }))
        .finally(() => setLoadingStaff(false));
    }
  }, [isOpen, step]);

  useEffect(() => {
    if (isOpen) {
      if (projectId) {
        // Fetch the specific project
        fetch(`/api/projects/${projectId}`)
          .then(res => res.json())
          .then(data => {
            if (data.data) {
              const p = data.data;
              setSelectedProject({
                id: p.id,
                name: p.project_name,
                description: p.description || '',
                status: p.status || 'active',
                startDate: p.start_date || '',
                endDate: p.end_date || ''
              });
              setStep('template');
            }
          })
          .catch(err => log.error('WorkflowAssignmentModal', { action: 'fetchProject', error: err }));
      } else {
        setStep('project');
      }
    } else {
      // Reset form when modal closes
      setStep('project');
      setSelectedProject(null);
      setSelectedTemplate(null);
      setWorkflowName('');
      setStartDate('');
      setEndDate('');
      setAssignedTo('');
      setTeamMembers([]);
      setNotes('');
      setSearchTerm('');
    }
  }, [isOpen, projectId]);

  useEffect(() => {
    if (selectedProject && selectedTemplate) {
      setWorkflowName(`${selectedTemplate.name} - ${selectedProject.name}`);
      setStartDate(selectedProject.startDate);
      setEndDate(selectedProject.endDate);
    }
  }, [selectedProject, selectedTemplate]);

  if (!isOpen) return null;

  const filteredTemplates = templates.filter(template =>
    template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    template.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleProjectSelect = (project: Project) => {
    setSelectedProject(project);
    setStep('template');
  };

  const handleTemplateSelect = (template: WorkflowTemplate) => {
    setSelectedTemplate(template);
    setStep('details');
  };

  const handleAssign = () => {
    if (!selectedProject || !selectedTemplate) return;

    const workflowData: CreateProjectWorkflowRequest = {
      projectId: selectedProject.id,
      workflowTemplateId: selectedTemplate.id,
      name: workflowName,
      startDate: startDate || '',
      plannedEndDate: endDate || '',
      assignedTo: assignedTo || '',
      teamMembers: teamMembers,
      notes: notes || ''
    };

    onAssign(workflowData);
  };

  const toggleTeamMember = (memberId: string) => {
    setTeamMembers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const canProceed = () => {
    switch (step) {
      case 'project':
        return selectedProject !== null;
      case 'template':
        return selectedTemplate !== null;
      case 'details':
        return workflowName.trim() !== '';
      default:
        return false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />
        
        <div className="inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-background shadow-xl rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-medium text-foreground">
                Assign Workflow to Project
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Select a project and template to create a new workflow
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-accent"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center space-x-4 mb-8">
            <div className={`flex items-center space-x-2 ${
              step === 'project' ? 'text-green-600' : selectedProject ? 'text-green-600' : 'text-gray-400'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                selectedProject ? 'bg-green-600 text-white' : step === 'project' ? 'bg-green-100 dark:bg-green-900/20 text-green-600' : 'bg-secondary text-gray-400'
              }`}>
                1
              </div>
              <span className="text-sm font-medium">Select Project</span>
            </div>
            <div className="w-12 h-0.5 bg-muted" />
            <div className={`flex items-center space-x-2 ${
              step === 'template' ? 'text-green-600' : selectedTemplate ? 'text-green-600' : 'text-gray-400'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                selectedTemplate ? 'bg-green-600 text-white' : step === 'template' ? 'bg-green-100 dark:bg-green-900/20 text-green-600' : 'bg-secondary text-gray-400'
              }`}>
                2
              </div>
              <span className="text-sm font-medium">Choose Template</span>
            </div>
            <div className="w-12 h-0.5 bg-muted" />
            <div className={`flex items-center space-x-2 ${
              step === 'details' ? 'text-green-600' : 'text-gray-400'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                step === 'details' ? 'bg-green-100 dark:bg-green-900/20 text-green-600' : 'bg-secondary text-gray-400'
              }`}>
                3
              </div>
              <span className="text-sm font-medium">Configure Details</span>
            </div>
          </div>

          {/* Content */}
          <div className="min-h-96">
            {/* Step 1: Select Project */}
            {step === 'project' && (
              <div>
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search projects..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-foreground"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 gap-4 max-h-80 overflow-y-auto">
                  {filteredProjects.map(project => (
                    <div
                      key={project.id}
                      onClick={() => handleProjectSelect(project)}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedProject?.id === project.id
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-border hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-foreground">
                            {project.name}
                          </h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            {project.description}
                          </p>
                          <div className="flex items-center space-x-4 mt-2 text-sm text-muted-foreground">
                            <span>Status: {project.status}</span>
                            <span>Duration: {project.startDate} - {project.endDate}</span>
                          </div>
                        </div>
                        {selectedProject?.id === project.id && (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Choose Template */}
            {step === 'template' && (
              <div>
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search templates..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-foreground"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-80 overflow-y-auto">
                  {filteredTemplates.map(template => (
                    <div
                      key={template.id}
                      onClick={() => handleTemplateSelect(template)}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedTemplate?.id === template.id
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-border hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-foreground">
                            {template.name}
                          </h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            {template.description}
                          </p>
                          <div className="flex items-center space-x-3 mt-3 text-sm">
                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                              template.category === 'project' 
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400'
                            }`}>
                              {template.category}
                            </span>
                            <span className="text-muted-foreground">
                              {template.phases?.length || 0} phases
                            </span>
                          </div>
                        </div>
                        {selectedTemplate?.id === template.id && (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Configure Details */}
            {step === 'details' && selectedProject && selectedTemplate && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Basic Info */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Workflow Name
                    </label>
                    <input
                      type="text"
                      value={workflowName}
                      onChange={(e) => setWorkflowName(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground"
                      placeholder="Enter workflow name"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">
                        Planned End Date
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Assign To
                    </label>
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground"
                    >
                      <option value="">Select project manager</option>
                      {staffMembers.map(member => (
                        <option key={member.id} value={member.id}>
                          {member.name} - {member.position}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Notes
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground"
                      placeholder="Additional notes or requirements..."
                    />
                  </div>
                </div>

                {/* Right Column - Team & Summary */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Team Members
                    </label>
                    <div className="max-h-40 overflow-y-auto border border-border rounded-lg p-2 space-y-2">
                      {loadingStaff ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-muted-foreground">Loading staff...</span>
                        </div>
                      ) : staffMembers.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No staff members available</p>
                      ) : (
                        staffMembers.map(member => (
                          <label key={member.id} className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={teamMembers.includes(member.id)}
                              onChange={() => toggleTeamMember(member.id)}
                              className="rounded border-border text-green-600 focus:ring-green-500"
                            />
                            <div className="flex-1">
                              <span className="text-sm font-medium text-foreground">
                                {member.name}
                              </span>
                              <span className="text-xs text-muted-foreground ml-2">
                                {member.position}
                              </span>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="bg-input rounded-lg p-4">
                    <h4 className="text-sm font-medium text-foreground mb-3">
                      Assignment Summary
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Project:</span>
                        <span className="text-foreground">{selectedProject.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Template:</span>
                        <span className="text-foreground">{selectedTemplate.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Phases:</span>
                        <span className="text-foreground">
                          {selectedTemplate.phases?.length || 0} phases
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Team Size:</span>
                        <span className="text-foreground">{teamMembers.length} members</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
            <div className="flex items-center space-x-2">
              {step !== 'project' && (
                <button
                  onClick={() => {
                    if (step === 'details') setStep('template');
                    else if (step === 'template') setStep('project');
                  }}
                  className="px-4 py-2 text-muted-foreground bg-secondary hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Back
                </button>
              )}
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground bg-secondary hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              
              {step === 'details' ? (
                <button
                  onClick={handleAssign}
                  disabled={!canProceed()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  Create Workflow
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (step === 'project') setStep('template');
                    else if (step === 'template') setStep('details');
                  }}
                  disabled={!canProceed()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}