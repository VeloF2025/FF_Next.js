/**
 * PDF Tools - Main Page
 * Lists all available PDF tools with FibreFlow styling
 */

import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout';
import { tools } from '@/modules/pdf-tools/config/tools';
import Link from 'next/link';
import {
  FileText,
  Search,
  Grid,
  List,
  Zap,
  Edit3,
  Shield,
  ArrowRightLeft,
  FileOutput
} from 'lucide-react';

// Category definitions with icons
const categories = [
  { id: 'organize-manage', name: 'Organize & Manage', icon: Grid, color: 'bg-blue-500' },
  { id: 'edit-annotate', name: 'Edit & Annotate', icon: Edit3, color: 'bg-purple-500' },
  { id: 'convert-to-pdf', name: 'Convert to PDF', icon: FileOutput, color: 'bg-green-500' },
  { id: 'convert-from-pdf', name: 'Convert from PDF', icon: ArrowRightLeft, color: 'bg-orange-500' },
  { id: 'optimize-repair', name: 'Optimize & Repair', icon: Zap, color: 'bg-yellow-500' },
  { id: 'secure-pdf', name: 'Security', icon: Shield, color: 'bg-red-500' },
];

export default function PDFToolsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Filter tools based on search and category
  const filteredTools = useMemo(() => {
    return tools.filter(tool => {
      const matchesSearch = searchQuery === '' ||
        tool.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.slug.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = !selectedCategory || tool.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  // Group tools by category
  const toolsByCategory = useMemo(() => {
    const grouped: Record<string, typeof tools> = {};
    filteredTools.forEach(tool => {
      if (!grouped[tool.category]) {
        grouped[tool.category] = [];
      }
      grouped[tool.category]!.push(tool);
    });
    return grouped;
  }, [filteredTools]);

  const formatToolName = (slug: string) => {
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            PDF Tools
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {tools.length} tools available for PDF processing
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg ${viewMode === 'grid'
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Grid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg ${viewMode === 'list'
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <List className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${!selectedCategory
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                ${selectedCategory === cat.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tools Display */}
      {viewMode === 'grid' ? (
        // Grid View - Grouped by Category
        <div className="space-y-8">
          {categories.map(category => {
            const categoryTools = toolsByCategory[category.id];
            if (!categoryTools || categoryTools.length === 0) return null;

            const CategoryIcon = category.icon;

            return (
              <div key={category.id}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`p-2 rounded-lg ${category.color}`}>
                    <CategoryIcon className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {category.name}
                  </h2>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    ({categoryTools.length})
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {categoryTools.map(tool => (
                    <Link
                      key={tool.id}
                      href={`/communications/pdf-tools/${tool.slug}`}
                      className="group p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200
                               dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500
                               hover:shadow-lg transition-all duration-200"
                    >
                      <div className="flex flex-col items-center text-center">
                        <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-xl
                                      group-hover:bg-blue-100 dark:group-hover:bg-blue-900
                                      transition-colors">
                          <FileText className="w-6 h-6 text-gray-600 dark:text-gray-400
                                             group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                        </div>
                        <span className="mt-3 text-sm font-medium text-gray-900 dark:text-white
                                       group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {formatToolName(tool.slug)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // List View
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          {filteredTools.map((tool, index) => {
            const category = categories.find(c => c.id === tool.category);

            return (
              <Link
                key={tool.id}
                href={`/communications/pdf-tools/${tool.slug}`}
                className={`flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-gray-700
                          transition-colors ${index !== 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}`}
              >
                <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div className="flex-1">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatToolName(tool.slug)}
                  </span>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700
                                 text-gray-600 dark:text-gray-400">
                    {category?.name}
                  </span>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {tool.acceptedFormats.join(', ')}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {filteredTools.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No tools found
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Try adjusting your search or filter criteria
          </p>
        </div>
      )}
    </div>
  );
}

PDFToolsPage.getLayout = (page: React.ReactElement) => (
  <AppLayout>{page}</AppLayout>
);
