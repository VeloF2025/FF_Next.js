/**
 * Project Detail Loading Component
 * Skeleton loading state that matches the actual page structure
 * Provides better perceived performance with content-aware placeholders
 */

/**
 * Reusable skeleton pulse component
 */
function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-[var(--ff-bg-tertiary)] rounded ${className}`}
    />
  );
}

/**
 * Header skeleton - matches ProjectDetailHeader
 */
function HeaderSkeleton() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Back button */}
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="space-y-2">
          {/* Project name */}
          <Skeleton className="h-7 w-64" />
          {/* Project code */}
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Edit button */}
        <Skeleton className="h-10 w-20 rounded-lg" />
        {/* More button */}
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Status badges skeleton - matches ProjectStatusBadges
 */
function BadgesSkeleton() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-7 w-20 rounded-full" />
      <Skeleton className="h-7 w-24 rounded-full" />
      <Skeleton className="h-7 w-20 rounded-full" />
    </div>
  );
}

/**
 * Tab navigation skeleton - matches ProjectTabs (6 primary tabs)
 */
function TabsSkeleton() {
  return (
    <div className="space-y-0">
      {/* Primary tabs */}
      <div className="border-b border-[var(--ff-border-light)]">
        <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="py-3 px-4 flex items-center justify-center">
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
      {/* Sub-tabs placeholder */}
      <div className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] py-2">
        <div className="flex items-center justify-center gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * KPI Cards skeleton - matches ProjectOverviewKPICards (4 cards)
 */
function KPICardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <Skeleton className="h-8 w-16 mb-1" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * Card skeleton - generic content card
 */
function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
      <Skeleton className="h-5 w-40 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Overview content skeleton - matches the Overview tab layout
 */
function OverviewContentSkeleton() {
  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <KPICardsSkeleton />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Project Info Card */}
          <CardSkeleton lines={5} />
          {/* Workflow Checklist */}
          <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
            <Skeleton className="h-5 w-48 mb-4" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
          {/* Progress Card */}
          <CardSkeleton lines={3} />
        </div>

        {/* Sidebar (1 col) */}
        <div className="space-y-6">
          {/* Key Details */}
          <CardSkeleton lines={6} />
          {/* Quick Stats */}
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}

/**
 * Main loading component
 */
export function ProjectDetailLoading() {
  return (
    <div className="space-y-6 px-6">
      {/* Header */}
      <HeaderSkeleton />

      {/* Status badges */}
      <BadgesSkeleton />

      {/* Tabs */}
      <TabsSkeleton />

      {/* Content area */}
      <OverviewContentSkeleton />
    </div>
  );
}

/**
 * Minimal loading for tab content switching
 * Use this when just the tab content is loading
 */
export function TabContentLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4"
          >
            <Skeleton className="h-5 w-32 mb-3" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Table loading skeleton
 * Use for tabs with data tables
 */
export function TableLoading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      {/* Table header */}
      <div className="px-4 py-3 border-b border-[var(--ff-border-light)] flex items-center gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-16 ml-auto" />
      </div>
      {/* Table rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="px-4 py-3 border-b border-[var(--ff-border-light)] last:border-b-0 flex items-center gap-4"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-8 w-8 rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}
