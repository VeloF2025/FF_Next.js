/**
 * Virtual Scrolling List Component
 * Optimizes rendering of large datasets by only rendering visible items
 */

import React, { 
  memo, 
  useMemo, 
  useCallback, 
  useState, 
  useEffect, 
  useRef,
  CSSProperties 
} from 'react';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  overscan?: number; // Number of items to render outside visible area
  className?: string;
  onScroll?: (scrollTop: number) => void;
}

const VirtualizedListComponent = <T,>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  getItemKey,
  overscan = 5,
  className,
  onScroll
}: VirtualizedListProps<T>) => {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const visibleStart = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleEnd = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    
    return { start: visibleStart, end: visibleEnd };
  }, [scrollTop, itemHeight, containerHeight, items.length, overscan]);

  // Calculate total height and visible items
  const totalHeight = items.length * itemHeight;
  const visibleItems = useMemo(() => {
    const visible = [];
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const item = items[i];
      if (item) {
        visible.push({
          item,
          index: i,
          key: getItemKey(item, i)
        });
      }
    }
    return visible;
  }, [items, visibleRange, getItemKey]);

  // Handle scroll events
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);
    onScroll?.(newScrollTop);
  }, [onScroll]);

  // Scroll to specific item
  const scrollToItem = useCallback((index: number) => {
    if (scrollElementRef.current) {
      const scrollPosition = index * itemHeight;
      scrollElementRef.current.scrollTop = scrollPosition;
    }
  }, [itemHeight]);

  // Expose scroll method
  React.useImperativeHandle(
    React.useRef<{ scrollToItem: (index: number) => void }>(),
    () => ({ scrollToItem }),
    [scrollToItem]
  );

  const containerStyle: CSSProperties = {
    height: containerHeight,
    overflow: 'auto',
    position: 'relative'
  };

  const contentStyle: CSSProperties = {
    height: totalHeight,
    position: 'relative'
  };

  const itemContainerStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    transform: `translateY(${visibleRange.start * itemHeight}px)`
  };

  return (
    <div
      ref={scrollElementRef}
      className={className}
      style={containerStyle}
      onScroll={handleScroll}
    >
      <div style={contentStyle}>
        <div style={itemContainerStyle}>
          {visibleItems.map(({ item, index, key }) => (
            <div
              key={key}
              style={{
                height: itemHeight,
                overflow: 'hidden'
              }}
            >
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const VirtualizedList = memo(VirtualizedListComponent) as typeof VirtualizedListComponent;

/**
 * Hook for managing virtual list state
 */
export function useVirtualList<T>(
  items: T[],
  options: {
    itemHeight: number;
    containerHeight: number;
    overscan?: number;
  }
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  
  // Debounce scrolling state
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
    
    return () => clearTimeout(timeout);
  }, [scrollTop]);

  const handleScroll = useCallback((newScrollTop: number) => {
    setScrollTop(newScrollTop);
    setIsScrolling(true);
  }, []);

  // Calculate current visible range
  const visibleRange = useMemo(() => {
    const overscan = options.overscan || 5;
    const start = Math.max(0, Math.floor(scrollTop / options.itemHeight) - overscan);
    const end = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + options.containerHeight) / options.itemHeight) + overscan
    );
    
    return { start, end };
  }, [scrollTop, options.itemHeight, options.containerHeight, options.overscan, items.length]);

  return {
    scrollTop,
    isScrolling,
    visibleRange,
    onScroll: handleScroll,
    totalHeight: items.length * options.itemHeight
  };
}

/**
 * Grid-based virtual scrolling for tables
 */
interface VirtualizedTableProps<T> {
  columns: Array<{
    key: string;
    header: string;
    width?: number;
    render?: (item: T, index: number) => React.ReactNode;
  }>;
  data: T[];
  rowHeight: number;
  containerHeight: number;
  getRowKey: (item: T, index: number) => string | number;
  onRowClick?: (item: T, index: number) => void;
  className?: string;
}

export const VirtualizedTable = memo(<T,>({
  columns,
  data,
  rowHeight,
  containerHeight,
  getRowKey,
  onRowClick,
  className
}: VirtualizedTableProps<T>) => {
  const renderRow = useCallback((item: T, index: number) => {
    const handleRowClick = () => onRowClick?.(item, index);
    
    return (
      <div
        className={`flex items-center border-b border-[var(--ff-border-light)] ${
          onRowClick ? 'hover:bg-[var(--ff-bg-hover)] cursor-pointer' : ''
        }`}
        onClick={handleRowClick}
      >
        {columns.map((column, columnIndex) => {
          const value = column.render
            ? column.render(item, index)
            : (item as any)[column.key];

          return (
            <div
              key={`${column.key}-${columnIndex}`}
              className="px-4 py-2 truncate"
              style={{ width: column.width || `${100 / columns.length}%` }}
            >
              {value}
            </div>
          );
        })}
      </div>
    );
  }, [columns, onRowClick]);

  return (
    <div className={`${className} border border-[var(--ff-border-light)] rounded-lg overflow-hidden`}>
      {/* Table Header */}
      <div className="flex bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)] sticky top-0 z-10">
        {columns.map((column, index) => (
          <div
            key={`header-${column.key}-${index}`}
            className="px-4 py-3 font-medium text-sm text-[var(--ff-text-primary)] truncate"
            style={{ width: column.width || `${100 / columns.length}%` }}
          >
            {column.header}
          </div>
        ))}
      </div>
      
      {/* Virtual List Body */}
      <VirtualizedList
        items={data}
        itemHeight={rowHeight}
        containerHeight={containerHeight - 48} // Subtract header height
        renderItem={renderRow}
        getItemKey={getRowKey}
      />
    </div>
  );
});

VirtualizedTable.displayName = 'VirtualizedTable';