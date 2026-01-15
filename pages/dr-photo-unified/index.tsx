/**
 * DR Photo Unified Review - Main Entry Page
 * Shows list of DRs from WA Monitor for photo review
 * Users can click a DR to review or search for specific DRs
 */

import { DrListPage } from '@/modules/dr-photo-unified/components/DrListPage';
import type { ReactElement } from 'react';
import type { NextPageWithLayout } from '@/pages/_app';

const DrPhotoUnifiedIndexPage: NextPageWithLayout = () => {
  return <DrListPage />;
};

// No sidebar layout - fullscreen for better UX
DrPhotoUnifiedIndexPage.getLayout = (page: ReactElement) => page;

export default DrPhotoUnifiedIndexPage;
