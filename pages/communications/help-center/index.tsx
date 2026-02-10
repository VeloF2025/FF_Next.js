/**
 * Help Center Page
 * URL: /communications/help-center
 *
 * Interactive user manual with search, navigation, and role-aware content.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout';
import { HelpCenterPage } from '@/modules/help-center/HelpCenterPage';

const HelpCenterRoute: NextPage = () => {
  return (
    <>
      <Head>
        <title>Help Center | FibreFlow</title>
        <meta name="description" content="FibreFlow interactive user manual and help center" />
      </Head>
      <AppLayout>
        <HelpCenterPage />
      </AppLayout>
    </>
  );
};

export default HelpCenterRoute;
