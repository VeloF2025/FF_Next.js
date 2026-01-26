'use client';

/**
 * Assets Module Client Wrapper
 * Provides ModulePage with horizontal tab navigation
 */

import { ReactNode } from 'react';
import { ModulePage } from '@/components/module-page';
import { assetsConfig } from '@/modules/navigation';

interface AssetsClientProps {
  children: ReactNode;
}

export default function AssetsClient({ children }: AssetsClientProps) {
  return (
    <ModulePage config={assetsConfig}>
      {children}
    </ModulePage>
  );
}
