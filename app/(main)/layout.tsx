/**
 * Main Layout for App Router pages that need sidebar navigation
 * Uses AppRouterLayout which is compatible with Next.js App Router
 */

import { AppRouterLayout } from '@/components/layout/AppRouterLayout';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppRouterLayout>{children}</AppRouterLayout>;
}
