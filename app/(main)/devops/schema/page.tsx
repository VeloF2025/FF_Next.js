/**
 * DevOps DB Schema Explorer Page
 * Visualize database schema with React Flow
 */

import { Suspense } from 'react';
import { SchemaExplorerClient } from './SchemaExplorerClient';

export default function SchemaExplorerPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading schema explorer...</div>}>
      <SchemaExplorerClient />
    </Suspense>
  );
}
