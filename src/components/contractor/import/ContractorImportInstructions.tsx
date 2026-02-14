/**
 * ContractorImportInstructions - User guidance for contractor import
 */

import { Info, CheckCircle } from 'lucide-react';

export function ContractorImportInstructions() {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <Info className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="ml-3">
            <h4 className="text-sm font-medium text-blue-900">Import Requirements</h4>
            <div className="mt-2 text-sm text-blue-700">
              <p>Your file should contain contractor information with the following required fields:</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h5 className="text-sm font-semibold text-foreground mb-2">Required Fields</h5>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li className="flex items-center">
              <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
              Company Name
            </li>
            <li className="flex items-center">
              <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
              Contact Person
            </li>
            <li className="flex items-center">
              <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
              Email Address
            </li>
            <li className="flex items-center">
              <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
              Registration Number
            </li>
          </ul>
        </div>

        <div>
          <h5 className="text-sm font-semibold text-foreground mb-2">Optional Fields</h5>
          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
            <div>• Phone Number</div>
            <div>• Business Type</div>
            <div>• Industry</div>
            <div>• Website</div>
            <div>• Address</div>
            <div>• City, State</div>
            <div>• License Number</div>
            <div>• Years in Business</div>
          </div>
        </div>

        <div className="bg-background border rounded-lg p-3">
          <h5 className="text-sm font-semibold text-foreground mb-2">Tips for Success</h5>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Use the first row for column headers</li>
            <li>• Ensure required fields are not empty</li>
            <li>• Valid email addresses are required</li>
            <li>• Registration numbers should be unique</li>
            <li>• Remove any merged cells in Excel files</li>
          </ul>
        </div>
      </div>
    </div>
  );
}