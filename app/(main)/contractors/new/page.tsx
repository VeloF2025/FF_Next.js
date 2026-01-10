/**
 * New Contractor Page
 */

import { ContractorForm } from '@/components/contractors/ContractorForm';

export default function NewContractorPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add New Contractor</h1>
        <p className="text-gray-600">Create a new contractor profile</p>
      </div>

      <ContractorForm />
    </div>
  );
}
