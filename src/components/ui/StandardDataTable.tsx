import { ReactNode, memo, useMemo, useCallback } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { AlertCircle, FileX } from 'lucide-react';

export interface TableColumn<T> {
  key: string;
  header: string;
  render?: (item: T) => ReactNode;
  className?: string;
  sortable?: boolean;
}

interface StandardDataTableProps<T> {
  columns: TableColumn<T>[];
  data?: T[];
  isLoading?: boolean;
  error?: Error | null;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  getRowKey: (item: T) => string;
  stickyHeader?: boolean;
}

const StandardDataTableComponent = <T,>({
  columns,
  data,
  isLoading = false,
  error = null,
  emptyMessage = 'No data found',
  onRowClick,
  getRowKey,
  stickyHeader = false
}: StandardDataTableProps<T>) => {
  // Memoize cell rendering for performance
  const renderCell = useCallback((item: T, column: TableColumn<T>) => {
    if (column.render) {
      return column.render(item);
    }
    const value = (item as any)[column.key];
    return value !== null && value !== undefined ? String(value) : '-';
  }, []);

  // Memoize row click handler to prevent unnecessary re-renders
  const handleRowClick = useCallback((item: T) => {
    onRowClick?.(item);
  }, [onRowClick]);

  // Memoize table rows to prevent re-rendering when data hasn't changed
  const tableRows = useMemo(() => {
    if (!data?.length) return null;
    
    return data.map((item) => (
      <tr
        key={getRowKey(item)}
        onClick={() => handleRowClick(item)}
        className={onRowClick ? "hover:bg-[var(--ff-bg-hover)] cursor-pointer transition-colors" : ""}
      >
        {columns.map((column) => (
          <td
            key={column.key}
            className="px-6 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]"
          >
            {renderCell(item, column)}
          </td>
        ))}
      </tr>
    ));
  }, [data, columns, getRowKey, handleRowClick, onRowClick, renderCell]);

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className={`bg-[var(--ff-bg-tertiary)] ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide ${
                    column.className || ''
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
            {isLoading && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  <LoadingSpinner className="mx-auto mb-2" />
                  Loading...
                </td>
              </tr>
            )}

            {error && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-red-400">
                  <AlertCircle className="mx-auto mb-2 h-12 w-12" />
                  Error: {error.message}
                </td>
              </tr>
            )}

            {!isLoading && !error && (!data || data.length === 0) && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  <FileX className="mx-auto mb-2 h-12 w-12 text-[var(--ff-text-tertiary)]" />
                  {emptyMessage}
                </td>
              </tr>
            )}
            
            {!isLoading && !error && tableRows}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Export memoized version for performance optimization
export const StandardDataTable = memo(StandardDataTableComponent) as typeof StandardDataTableComponent;

// Pagination Component
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange
}: PaginationProps) {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const renderPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    if (startPage > 1) {
      pages.push(
        <button
          key={1}
          onClick={() => onPageChange(1)}
          className="px-3 py-1 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)]"
        >
          1
        </button>
      );
      if (startPage > 2) {
        pages.push(<span key="ellipsis1" className="px-2">...</span>);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <button
          key={i}
          onClick={() => onPageChange(i)}
          className={`px-3 py-1 text-sm border rounded ${
            i === currentPage
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)]'
          }`}
        >
          {i}
        </button>
      );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push(<span key="ellipsis2" className="px-2 text-[var(--ff-text-secondary)]">...</span>);
      }
      pages.push(
        <button
          key={totalPages}
          onClick={() => onPageChange(totalPages)}
          className="px-3 py-1 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)]"
        >
          {totalPages}
        </button>
      );
    }

    return pages;
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--ff-bg-secondary)] border-t border-[var(--ff-border-light)]">
      <div className="text-sm text-[var(--ff-text-secondary)]">
        Showing <span className="font-medium text-[var(--ff-text-primary)]">{startItem}</span> to{' '}
        <span className="font-medium text-[var(--ff-text-primary)]">{endItem}</span> of{' '}
        <span className="font-medium text-[var(--ff-text-primary)]">{totalItems}</span> results
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-3 py-1 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>

        <div className="flex items-center gap-1">
          {renderPageNumbers()}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-3 py-1 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}