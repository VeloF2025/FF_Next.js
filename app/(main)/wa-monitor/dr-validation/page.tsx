/**
 * DR Validation Page
 * Route: /wa-monitor/dr-validation
 * DR number validation and reconciliation tool for Janice
 */

import { DrValidationClient } from './DrValidationClient';

export const metadata = {
  title: 'DR Validation | FibreFlow',
  description: 'DR number validation and reconciliation tool',
};

// Force dynamic rendering (no static generation)
export const dynamic = 'force-dynamic';

export default function DrValidationPage() {
  return <DrValidationClient />;
}
