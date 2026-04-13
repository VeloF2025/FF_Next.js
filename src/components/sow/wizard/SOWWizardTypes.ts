export interface SOWUploadStep {
  id: 'poles' | 'fibers' | 'drops' | 'column-mapping';
  title: string;
  description: string;
  file?: File;
  data?: Record<string, unknown>[];
  completed: boolean;
  required?: boolean;
}

export interface SOWUploadWizardProps {
  projectId: string;
  projectName: string;
  onComplete: () => void;
}

export const INITIAL_STEPS: SOWUploadStep[] = [
  {
    id: 'column-mapping',
    title: 'Column Mapping',
    description: 'Standardize column names for database import',
    completed: false,
    required: true
  },
  {
    id: 'poles',
    title: 'Upload Poles',
    description: 'Upload pole location and specification data',
    completed: false,
    required: true
  },
  {
    id: 'fibers',
    title: 'Upload Fibers',
    description: 'Upload fiber optic cable data',
    completed: false,
    required: false
  },
  {
    id: 'drops',
    title: 'Upload Drops',
    description: 'Upload drop connection data',
    completed: false,
    required: false
  }
];