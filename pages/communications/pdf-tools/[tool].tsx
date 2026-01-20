/**
 * PDF Tools - Individual Tool Page
 * Dynamic page that loads specific PDF tool components
 */

import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { tools } from '@/modules/pdf-tools/config/tools';
import Link from 'next/link';
import { ArrowLeft, FileText, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo, Suspense } from 'react';

// Loading component
const ToolLoading = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

// Error component
const ToolError = ({ toolSlug }: { toolSlug: string }) => (
  <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
    <AlertCircle className="w-16 h-16 text-yellow-500 mb-4" />
    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
      Tool Not Available
    </h2>
    <p className="text-gray-500 dark:text-gray-400 mb-4">
      The tool &quot;{toolSlug}&quot; is currently being integrated.
    </p>
    <Link
      href="/communications/pdf-tools"
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
    >
      Back to Tools
    </Link>
  </div>
);

// Map tool slugs to their component paths
const toolComponentMap: Record<string, React.ComponentType<unknown>> = {
  // Will be populated as we integrate tools
};

// Dynamically import tool components
const getToolComponent = (slug: string) => {
  // For now, return a placeholder that shows the tool is coming soon
  // As we integrate each tool, we'll add proper dynamic imports
  return null;
};

export default function ToolPage() {
  const router = useRouter();
  const { tool: toolSlug } = router.query;

  const toolConfig = useMemo(() => {
    if (!toolSlug || typeof toolSlug !== 'string') return null;
    return tools.find(t => t.slug === toolSlug);
  }, [toolSlug]);

  const formatToolName = (slug: string) => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (!toolSlug || typeof toolSlug !== 'string') {
    return <ToolLoading />;
  }

  const ToolComponent = toolComponentMap[toolSlug];

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/communications/pdf-tools"
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400
                   hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to PDF Tools
        </Link>
      </div>

      {/* Tool Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-xl">
            <FileText className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatToolName(toolSlug)}
            </h1>
            {toolConfig && (
              <p className="text-gray-500 dark:text-gray-400 mt-1">
                Accepts: {toolConfig.acceptedFormats.join(', ')} •
                Max files: {toolConfig.maxFiles}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tool Content */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        {ToolComponent ? (
          <Suspense fallback={<ToolLoading />}>
            <ToolComponent />
          </Suspense>
        ) : (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 dark:bg-blue-900 rounded-full mb-6">
              <FileText className="w-10 h-10 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {formatToolName(toolSlug)}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
              This PDF tool is being integrated into FibreFlow.
              It will be available soon with full functionality.
            </p>

            {toolConfig && (
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-w-sm mx-auto">
                <h3 className="font-medium text-gray-900 dark:text-white mb-2">Tool Info</h3>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <p>Category: {toolConfig.category.replace('-', ' ')}</p>
                  <p>Input: {toolConfig.acceptedFormats.join(', ')}</p>
                  <p>Output: {toolConfig.outputFormat}</p>
                  <p>Max files: {toolConfig.maxFiles}</p>
                </div>
              </div>
            )}

            <div className="mt-8">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                In the meantime, you can use the standalone version:
              </p>
              <a
                href={`http://localhost:3005/en/tools/${toolSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white
                         rounded-lg hover:bg-blue-700 transition-colors"
              >
                Open in PDFCraft
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Related Tools */}
      {toolConfig?.relatedTools && toolConfig.relatedTools.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Related Tools
          </h3>
          <div className="flex flex-wrap gap-3">
            {toolConfig.relatedTools.map(relatedSlug => (
              <Link
                key={relatedSlug}
                href={`/communications/pdf-tools/${relatedSlug}`}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg
                         text-gray-700 dark:text-gray-300 hover:bg-blue-100
                         dark:hover:bg-blue-900 hover:text-blue-600 dark:hover:text-blue-400
                         transition-colors"
              >
                {formatToolName(relatedSlug)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

ToolPage.getLayout = (page: React.ReactElement) => (
  <AppLayout>{page}</AppLayout>
);
