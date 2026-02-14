/**
 * List Optimization Utilities
 * Optimized list rendering components and hooks
 */

import React, { memo, useMemo, useCallback } from 'react';

/**
 * Optimized list rendering wrapper
 * Memoizes list items to prevent unnecessary re-renders
 */
export function OptimizedList<T>({
  items,
  renderItem,
  keyExtractor,
  emptyMessage = 'No items',
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  emptyMessage?: string;
}) {
  const renderedItems = useMemo(
    () =>
      items.map((item, index) => (
        <MemoizedListItem
          key={keyExtractor(item, index)}
          item={item}
          index={index}
          renderItem={renderItem}
        />
      )),
    [items, renderItem, keyExtractor]
  );

  if (items.length === 0) {
    return <div className="text-center text-gray-500 dark:text-gray-400 py-8">{emptyMessage}</div>;
  }

  return <>{renderedItems}</>;
}

/**
 * Memoized list item component
 */
const MemoizedListItem = memo(
  function ListItem<T>({
    item,
    index,
    renderItem,
  }: {
    item: T;
    index: number;
    renderItem: (item: T, index: number) => React.ReactNode;
  }) {
    return <>{renderItem(item, index)}</>;
  },
  (prev, next) => {
    return prev.item === next.item && prev.index === next.index;
  }
);

/**
 * Virtualized list hook
 * For rendering large lists efficiently
 */
export function useVirtualization({
  itemCount,
  itemHeight,
  containerHeight,
  overscan = 3,
}: {
  itemCount: number;
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = React.useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    itemCount - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = React.useMemo(
    () => Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i),
    [startIndex, endIndex]
  );

  const totalHeight = itemCount * itemHeight;
  const offsetY = startIndex * itemHeight;

  return {
    visibleItems,
    totalHeight,
    offsetY,
    onScroll: useCallback((e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    }, []),
  };
}
