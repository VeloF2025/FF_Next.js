/**
 * QA Centre Page - DR List with Search/Filters
 * Lists DRs for QA review with search, date filters, and pagination
 * Clicking a DR navigates to the detail review page
 */

import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { QaCentrePage } from '@/modules/activate/components/QaCentrePage';

const QaCentreIndexPage: NextPage = () => {
  return (
    <AppLayout>
      <QaCentrePage />
    </AppLayout>
  );
};

export default QaCentreIndexPage;
