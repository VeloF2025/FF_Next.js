// ============= Getting Started Guide Component =============

export function GettingStartedGuide() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Getting Started with Procurement Portal</h2>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">1</div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Select a Project</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Choose a project from the dropdown above to access procurement modules.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">2</div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Import BOQ</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Upload your Excel BOQ file to start the procurement process with catalog mapping.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">3</div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Create RFQ</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Generate RFQs from approved BOQ items and invite suppliers to quote.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">4</div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Evaluate & Award</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Compare supplier quotes, perform technical evaluation, and award contracts.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-sm font-medium">5</div>
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Manage Stock</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Process deliveries, track cable drums, and manage inter-project transfers.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
