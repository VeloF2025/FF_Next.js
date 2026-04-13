import { PoleData, DropData, PoleStatus } from '../../types/pole-tracker.types';

export interface PoleFormData {
  projectId: string;
  poleNumber: string;
  status: PoleStatus;
  maxDrops: number;
  currentDrops: number;
  drops: DropData[];
  latitude?: number;
  longitude?: number;
  photos?: Record<string, unknown>;
  notes?: string;
}

export interface PoleCaptureMobileProps {
  projectId: string;
  onSave: (data: Partial<PoleData>) => Promise<void>;
  onCancel: () => void;
}

export interface PhotoCapture {
  id: string;
  label: string;
  required: boolean;
  captured: boolean;
  url?: string;
  file?: File;
}

export const REQUIRED_PHOTOS: PhotoCapture[] = [
  { id: 'pole_number', label: 'Pole Number', required: true, captured: false },
  { id: 'pole_overview', label: 'Pole Overview', required: true, captured: false },
  { id: 'drop_connections', label: 'Drop Connections', required: true, captured: false },
  { id: 'fiber_routing', label: 'Fiber Routing', required: true, captured: false },
  { id: 'ground_level', label: 'Ground Level', required: true, captured: false },
  { id: 'safety_compliance', label: 'Safety Compliance', required: true, captured: false },
];