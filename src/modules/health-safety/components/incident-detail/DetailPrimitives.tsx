/**
 * Shared presentational primitives for the incident detail view
 */

import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function BackLink() {
  return (
    <Link
      href="/health-safety/incidents"
      className="inline-flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      Back to Incidents
    </Link>
  );
}

export function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider mb-4">
        <Icon className="w-4 h-4" />
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Field({
  label,
  value,
  secondary,
}: {
  label: string;
  value?: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">{label}</p>
      {value !== undefined && <p className="text-[var(--ff-text-primary)]">{value}</p>}
      {secondary && <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">{secondary}</p>}
    </div>
  );
}
