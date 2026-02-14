/**
 * Project Detail Not Found Component
 * Error state when project is not found
 */

interface ProjectDetailNotFoundProps {
  onNavigateBack: () => void;
}

export function ProjectDetailNotFound({ onNavigateBack }: ProjectDetailNotFoundProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="text-red-500 text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Project not found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          The project you're looking for doesn't exist or has been deleted.
        </p>
        <button
          onClick={onNavigateBack}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to Projects
        </button>
      </div>
    </div>
  );
}