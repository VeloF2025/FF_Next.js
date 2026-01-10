/**
 * All Contractors Documents Summary Page
 *
 * Displays document completion status for all contractors
 */

import React from 'react';
import AllContractorsSummary from '@/modules/contractor-documents-report/components/AllContractorsSummary';

export default function ContractorsDocumentsReportPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AllContractorsSummary />
    </div>
  );
}
