/**
 * /field-ops/works-qa — Works QA Dashboard route.
 *
 * Wraps the WorksQAPage component inside AppLayout so it shares
 * the standard sidebar / header chrome.
 */
import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { WorksQAPage } from '@/modules/works-qa/components/WorksQAPage';

// 🟢 WORKING: standard Next.js page — layout + head + feature component
const WorksQARoute: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Works QA | FibreFlow</title>
    </Head>
    <WorksQAPage />
  </AppLayout>
);

export default WorksQARoute;
