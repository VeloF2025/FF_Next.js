/**
 * WhatsApp Portal Page
 * URL: /communications/whatsapp
 *
 * Admin interface for managing WhatsApp services, groups, templates, and logs.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout';
import WhatsAppPortal from '@/modules/communications/whatsapp/WhatsAppPortal';

const WhatsAppPortalPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>WhatsApp Portal | FibreFlow</title>
        <meta name="description" content="Manage WhatsApp services, groups, templates, and message logs" />
      </Head>
      <AppLayout>
        <WhatsAppPortal />
      </AppLayout>
    </>
  );
};

export default WhatsAppPortalPage;
