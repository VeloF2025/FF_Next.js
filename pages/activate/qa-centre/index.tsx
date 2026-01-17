/**
 * QA Centre Page - DR List with Search/Filters
 * Lists DRs for QA review with search, date filters, and pagination
 * Clicking a DR navigates to the detail review page
 */

import { QaCentrePage } from '@/modules/activate/components/QaCentrePage';
import type { ReactElement } from 'react';
import type { NextPageWithLayout } from '@/pages/_app';

const QaCentreIndexPage: NextPageWithLayout = () => {
  return <QaCentrePage />;
};

// No sidebar layout - fullscreen for better UX
QaCentreIndexPage.getLayout = (page: ReactElement) => page;

export default QaCentreIndexPage;
