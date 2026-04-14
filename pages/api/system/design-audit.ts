/**
 * Design System Audit API
 * Scans the codebase and returns component usage metrics
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { execSync } from 'child_process';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';

function countGrep(pattern: string, path: string = 'src/modules/', glob: string = '*.tsx'): number {
  try {
    const result = execSync(
      `grep -rn "${pattern}" ${path} --include="${glob}" | grep -v __tests__ | grep -v node_modules | wc -l`,
      { cwd: process.cwd(), timeout: 10000 }
    );
    return parseInt(result.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function countFiles(pattern: string, path: string = 'src/modules/', glob: string = '*.tsx'): number {
  try {
    const result = execSync(
      `grep -rln "${pattern}" ${path} --include="${glob}" | grep -v __tests__ | grep -v node_modules | wc -l`,
      { cwd: process.cwd(), timeout: 10000 }
    );
    return parseInt(result.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function getTopPatterns(grepCmd: string, limit: number = 15): Array<{ pattern: string; count: number }> {
  try {
    const result = execSync(grepCmd, { cwd: process.cwd(), timeout: 15000 });
    return result
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, limit)
      .map((line) => {
        const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
        if (match) return { count: parseInt(match[1]!, 10), pattern: match[2]! };
        return { count: 0, pattern: line.trim() };
      })
      .filter((r) => r.count > 0);
  } catch {
    return [];
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const audit = {
      timestamp: new Date().toISOString(),

      // Buttons
      buttons: {
        rawButton: countGrep('<button ', 'src/modules/'),
        ffButtonClass: countGrep('ff-button', 'src/modules/'),
        buttonComponent: countFiles("from '@/components/ui/button", 'src/'),
        velocityButton: countFiles('VelocityButton', 'src/modules/'),
        topPatterns: getTopPatterns(
          `grep -rn 'className="' src/modules/ --include="*.tsx" | grep "<button" | grep -v __tests__ | sed 's/.*className="//' | sed 's/".*//' | sort | uniq -c | sort -rn | head -15`
        ),
      },

      // Tables
      tables: {
        rawTable: countGrep('<table', 'src/modules/'),
        standardDataTable: countFiles('StandardDataTable', 'src/modules/'),
        ffTableClass: countGrep('ff-table', 'src/modules/'),
        muiDataGrid: countFiles('DataGrid', 'src/modules/'),
      },

      // Modals
      modals: {
        diyOverlays: countGrep('fixed inset-0', 'src/modules/'),
        confirmDialog: countFiles('ConfirmDialog', 'src/modules/'),
        windowConfirm: countGrep('confirm(', 'src/modules/'),
      },

      // Cards
      cards: {
        ffCardClass: countFiles('ff-card', 'src/modules/'),
        glassCard: countFiles('GlassCard', 'src/modules/'),
        adHocCards: countFiles('bg-\\[var(--ff-bg-', 'src/modules/'),
      },

      // Loading
      loading: {
        diySpinner: countFiles('animate-spin', 'src/modules/'),
        loadingSpinner: countFiles('LoadingSpinner', 'src/modules/'),
        diySkeleton: countFiles('animate-pulse', 'src/modules/'),
        velocitySpinner: countFiles('VelocitySpinner', 'src/modules/'),
      },

      // Inputs
      inputs: {
        rawInput: countGrep('<input ', 'src/modules/'),
        ffInputClass: countGrep('ff-input', 'src/modules/'),
        muiTextField: countFiles('TextField', 'src/modules/'),
        velocityInput: countFiles('VelocityInput', 'src/modules/'),
      },

      // Colors
      colors: {
        cssVarUsage: countGrep('var(--ff-', 'src/modules/'),
        hardcodedTailwind: countGrep('bg-blue-\\|bg-gray-\\|bg-red-\\|bg-green-\\|text-blue-\\|text-gray-', 'src/modules/'),
        darkPrefix: countGrep('dark:', 'src/modules/'),
      },

      // Icons
      icons: {
        lucide: countFiles("from 'lucide-react'", 'src/modules/'),
        muiIcons: countFiles("from '@mui/icons", 'src/modules/'),
        inlineSvg: countGrep('<svg ', 'src/modules/'),
      },

      // Navigation
      navigation: {
        moduleNav: countFiles('ModuleNav', 'src/'),
        roleTabs: countGrep('role="tab"', 'src/modules/'),
      },

      // Toasts
      toasts: {
        directToast: countFiles("from 'react-hot-toast'", 'src/modules/'),
        notificationService: countFiles('notificationService', 'src/modules/'),
      },

      // Shared component adoption
      sharedComponents: {
        standardModuleHeader: countFiles('StandardModuleHeader', 'src/modules/'),
        standardSummaryCards: countFiles('StandardSummaryCards', 'src/modules/'),
        standardSearchFilter: countFiles('StandardSearchFilter', 'src/modules/'),
        standardDataTable: countFiles('StandardDataTable', 'src/modules/'),
        standardActionButtons: countFiles('StandardActionButtons', 'src/modules/'),
        statCard: countFiles('StatCard', 'src/modules/'),
        badge: countFiles("from '@/components/ui/Badge", 'src/modules/'),
        confirmDialog: countFiles('ConfirmDialog', 'src/modules/'),
      },
    };

    return apiResponse.success(res, audit);
  } catch (error) {
    log.error('Design audit scan failed', { error });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
