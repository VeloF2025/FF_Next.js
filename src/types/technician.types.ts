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

/**
 * Summary for activators (DR photo submitters via WhatsApp)
 */
export interface ActivatorSummary {
  id: string;
  name: string;
  phone: string | null;
  type: 'activator';
  contractor: string | null;
  status: TechnicianStatus;

  // Activator-specific stats
  totalSubmissions: number;      // DRs submitted via WhatsApp
  firstPassRate: number;         // % passed QA on first submission
  serialComplianceRate: number;  // % with ONT serial scanned
  lastActiveDate: string | null;
}

/**
 * Summary for installers (field technicians who do installations)
 */
export interface InstallerSummary {
  id: string;
  name: string;
  phone: string | null;
  type: 'installer';
  contractor: string | null;
  status: TechnicianStatus;

  // Installer-specific stats (from QA review outcomes)
  totalInstallations: number;    // DRs with this installer in drops table
  qaPassRate: number;            // % of installations with qa_decision = 'PASS'
  reworkRate: number;            // % with qa_decision = 'REWORK_NEEDED'
  lastActiveDate: string | null;
}

/**
 * Union type for directory listing - can be either activator or installer
 */
export type TechnicianSummary = ActivatorSummary | InstallerSummary;

/**
 * Helper to check if a technician is an activator
 */
export function isActivator(tech: TechnicianSummary): tech is ActivatorSummary {
  return tech.type === 'activator';
}

/**
 * Helper to check if a technician is an installer
 */
export function isInstaller(tech: TechnicianSummary): tech is InstallerSummary {
  return tech.type === 'installer';
}

/**
 * Performance metrics for activators (DR photo submitters)
 */
export interface ActivatorPerformance {
  technicianId: string;
  technicianName: string;
  type: 'activator';

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

/**
 * Performance metrics for installers (based on QA review outcomes)
 */
export interface InstallerPerformance {
  technicianId: string;
  technicianName: string;
  type: 'installer';

  dateRange: {
    from: string;
    to: string;
  };

  summary: {
    totalInstallations: number;
    qaPassedCount: number;
    qaPassRate: number;
    qaFailedCount: number;
    reworkCount: number;
    reworkRate: number;
    avgStepsCompliance: number;    // Avg % of 10 steps passed
    activatedCount: number;        // Count that appear on OES
    activationRate: number;
    // Signal quality metrics (from VLM power meter extraction)
    avgDbReading: number | null;   // Average dBm reading
    dbInRangeCount: number;        // Count with dBm in valid range (-18 to -24)
    dbInRangeRate: number;         // % with valid dBm
    projectsWorked: string[];
    activeDays: number;
  };

  trend: {
    date: string;
    installations: number;
    passed: number;
    failed: number;
  }[];

  projectBreakdown: {
    project: string;
    installations: number;
    qaPassRate: number;
  }[];

  commonFailures: {
    step: string;
    failCount: number;
  }[];
}

/**
 * Union type for performance data
 */
export type TechnicianPerformance = ActivatorPerformance | InstallerPerformance;

/**
 * Helper to check if performance is for an activator
 */
export function isActivatorPerformance(perf: TechnicianPerformance): perf is ActivatorPerformance {
  return perf.type === 'activator';
}

/**
 * Helper to check if performance is for an installer
 */
export function isInstallerPerformance(perf: TechnicianPerformance): perf is InstallerPerformance {
  return perf.type === 'installer';
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
