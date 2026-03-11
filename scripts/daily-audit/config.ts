/**
 * Daily Audit Configuration
 * Central configuration for all audit suites, thresholds, and service URLs
 */

export interface AuditConfig {
  name: string;
  version: string;
  environment: string;

  // Server URLs
  servers: {
    fibreflow: {
      production: string;
      dev: string;
      local: string;
    };
    velocity: string;
    vps: string;
  };

  // External service endpoints
  services: {
    vlm: { url: string; healthPath: string };
    waBridge: { url: string; healthPath: string };
    vfStorage: { url: string; healthPath: string };
    qfieldSync: { url: string; healthPath: string };
    oneMap: { baseUrl: string; testEndpoint: string };
    sage: { baseUrl: string; tokenEndpoint: string };
    resend: { baseUrl: string; testEndpoint: string };
  };

  // Thresholds
  thresholds: {
    api: {
      responseTimeWarning: number;  // ms
      responseTimeCritical: number; // ms
      timeoutMs: number;
    };
    database: {
      latencyWarning: number;  // ms
      latencyCritical: number; // ms
    };
    memory: {
      warningMB: number;
      criticalMB: number;
    };
  };

  // Priority definitions
  priorities: {
    P0: string[];  // Critical - must pass
    P1: string[];  // Important - should pass
    P2: string[];  // Nice to have
  };

  // Slack configuration
  slack: {
    webhookUrl: string | null;
    channel: string;
    alertOnP0Failure: boolean;
    dailySummary: boolean;
  };

  // Report settings
  reports: {
    htmlPath: string;
    jsonDir: string;
    retentionDays: number;
  };
}

// Determine environment
const getEnvironment = (): string => {
  return process.env.AUDIT_ENV || process.env.NODE_ENV || 'development';
};

// Get base URL for current environment
const getBaseUrl = (): string => {
  const env = getEnvironment();
  switch (env) {
    case 'production':
      return 'https://app.fibreflow.app';
    case 'development':
      return 'https://dev.fibreflow.app';
    default:
      return 'http://localhost:3004';
  }
};

export const config: AuditConfig = {
  name: 'FibreFlow Daily Audit',
  version: '1.0.0',
  environment: getEnvironment(),

  servers: {
    fibreflow: {
      production: 'https://app.fibreflow.app',
      dev: 'https://dev.fibreflow.app',
      local: 'http://localhost:3004',
    },
    velocity: 'http://100.96.203.105',
    vps: 'http://72.61.197.178',
  },

  services: {
    vlm: {
      url: 'http://100.96.203.105:8100',
      healthPath: '/health',
    },
    waBridge: {
      url: 'http://72.61.197.178:8083',
      healthPath: '/health',
    },
    vfStorage: {
      url: 'http://100.96.203.105:8091',
      healthPath: '/health',
    },
    qfieldSync: {
      url: 'http://100.96.203.105:8095',
      healthPath: '/health',
    },
    oneMap: {
      baseUrl: 'https://api.1map.co.za',
      testEndpoint: '/v1/layers',
    },
    sage: {
      baseUrl: 'https://oauth.accounting.sage.com',
      tokenEndpoint: '/token',
    },
    resend: {
      baseUrl: 'https://api.resend.com',
      testEndpoint: '/domains',
    },
  },

  thresholds: {
    api: {
      responseTimeWarning: 2000,   // 2 seconds
      responseTimeCritical: 5000, // 5 seconds
      timeoutMs: 10000,           // 10 seconds
    },
    database: {
      latencyWarning: 300,   // 300ms (Neon pooler adds latency)
      latencyCritical: 1000, // 1000ms
    },
    memory: {
      warningMB: 500,
      criticalMB: 800,
    },
  },

  priorities: {
    P0: [
      'api-health',
      'database-health',
      'external-services',
    ],
    P1: [
      'navigation',
      'cross-module',
    ],
    P2: [
      'button-actions',
    ],
  },

  slack: {
    webhookUrl: process.env.SLACK_AUDIT_WEBHOOK || null,
    channel: '#fibreflow-alerts',
    alertOnP0Failure: true,
    dailySummary: true,
  },

  reports: {
    htmlPath: 'public/audit-report.html',
    jsonDir: 'scripts/daily-audit/results',
    retentionDays: 30,
  },
};

// Export convenience functions
export const getBaseUrl_fn = getBaseUrl;
export const getEnvironment_fn = getEnvironment;

// Critical tables that must exist and have data
export const criticalTables = [
  'users',
  'projects',
  'clients',
  'contractors',
  'drops',
  'qa_photo_reviews',
  'dr_photo_unified_reviews',
  'purchase_orders',
  'fleet_vehicles',
  'fleet_check_records',
  'boq_items',
  'rfqs',
  'staff',
  'custom_roles',
  'access_permissions',
];

// Navigation sections to test (from navigationConfig.ts)
export const navigationSections = [
  'main',           // Dashboard, Meetings, Action Items
  'project',        // Projects, Clients, Contractors
  'activate',       // QA review
  'noc',            // Network Operations Centre
  'procurement',    // Materials
  'assets',         // Equipment
  'fleet',          // Vehicles
  'people',         // HR/Staff
  'analytics',      // Metrics
  'communications', // WhatsApp, meetings
  'system',         // Admin tools
];

// API endpoint patterns to exclude from testing
export const excludedApiPatterns = [
  '/api/auth/',           // Auth endpoints need special handling
  '/api/webhook/',        // Webhooks are external-triggered
  '/api/internal/',       // Internal-only endpoints
  '/_next/',              // Next.js internal
  '/api/cron/',           // Cron jobs
];

// Modules for cross-module testing
export const moduleIntegrations = [
  {
    name: 'SOW Import → Drops',
    sourceModule: 'sow',
    targetTable: 'drops',
    description: 'SOW imports create drop records',
  },
  {
    name: 'DR Photo → Unified Reviews',
    sourceModule: 'dr-photos',
    targetTable: 'dr_photo_unified_reviews',
    description: 'DR photos flow to unified review system',
  },
  {
    name: 'QA Approval → WhatsApp',
    sourceModule: 'activate',
    targetService: 'wa-sender',
    description: 'QA approvals trigger WhatsApp notifications',
  },
  {
    name: 'PO Creation → Purchase Orders',
    sourceModule: 'procurement',
    targetTable: 'purchase_orders',
    description: 'PO workflow creates purchase order records',
  },
  {
    name: 'Fleet Check-in → VLM',
    sourceModule: 'fleet',
    targetService: 'vlm',
    description: 'Fleet check-ins use VLM for plate reading',
  },
];

export default config;
