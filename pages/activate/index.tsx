/**
 * DR Photo Unified Review - Main Entry Page
 * Shows list of DRs from WA Monitor for photo review
 * Users can click a DR to review or search for specific DRs
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { DrListPage } from '@/modules/activate/components/DrListPage';

const ActivateIndexPage: NextPage = () => {
  return (
    <AppLayout>
      <DrListPage />
    </AppLayout>
  );
};

export default ActivateIndexPage;
