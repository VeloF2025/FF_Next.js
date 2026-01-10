/**
 * Contractor Documents Report Page
 *
 * Displays comprehensive document status report for a single contractor
 */

import React from 'react';
import SingleContractorReport from '@/modules/contractor-documents-report/components/SingleContractorReport';

export default function ContractorDocumentsReportPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SingleContractorReport contractorId={params.id} showBackButton={true} />
    </div>
  );
}
