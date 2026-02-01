/**
 * Technician Types
 * 
 * Represents field technicians who submit DR photos (activators) 
 * or perform installations (installers).
 * 
 * These are SEPARATE from internal Staff (HR records).
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

export type TechnicianType = 'activator' | 'installer';
export type TechnicianStatus = 'active' | 'inactive' | 'blocked';

export interface Technician {
  id: string;
  
  // Basic info
  name: string;
  phone: string | null;
  email: string | null;
  
  // Type
  type: TechnicianType;
  
  // WhatsApp linking (for activators)
  waSenderJid: string | null;  // e.g., "199209844252927@lid"
  waGroupJid: string | null;   // Which WA group they submit from
  
  // OneMap linking (for installers)
  onemapInstallerName: string | null;  // Matches installer_name field in 1Map
  
  // Organization
  contractor: string | null;   // e.g., "Team Alpha", "XYZ Contractors"
  projects: string[];          // Project codes they work on
  
  // Status & metadata
  status: TechnicianStatus;
  notes: string | null;
  
  // Auto-discovery source
  discoveredFrom: 'whatsapp' | 'onemap' | 'manual' | null;
  discoveredAt: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface TechnicianSummary {
  id: string;
  name: string;
  phone: string | null;
  type: TechnicianType;
  contractor: string | null;
  status: TechnicianStatus;
  
  // Performance stats (calculated)
  totalSubmissions: number;
  firstPassRate: number;
  serialComplianceRate: number;
  lastActiveDate: string | null;
}

export interface TechnicianPerformance {
  technicianId: string;
  technicianName: string;
  type: TechnicianType;
  
  dateRange: {
    from: string;
    to: string;
  };
  
  summary: {
    totalSubmissions: number;
    firstPassSuccess: number;
    firstPassRate: number;
    resubmissions: number;
    resubmissionRate: number;
    ontScanned: number;
    upsScanned: number;
    serialComplianceRate: number;
    projectsWorked: string[];
    activeDays: number;
  };
  
  trend: {
    date: string;
    submissions: number;
    firstPass: number;
    resubmissions: number;
  }[];
  
  projectBreakdown: {
    project: string;
    submissions: number;
    firstPassRate: number;
    serialComplianceRate: number;
  }[];
}

export interface DiscoveredTechnician {
  identifier: string;     // Phone or wa_sender_jid
  source: 'whatsapp' | 'onemap';
  sampleName: string | null;
  submissionCount: number;
  lastSeen: string;
  projects: string[];
  alreadyLinked: boolean;
}

export interface TechnicianFilters {
  type?: TechnicianType;
  status?: TechnicianStatus;
  contractor?: string;
  project?: string;
  search?: string;
}
