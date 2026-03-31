/**
 * H&S Audit Detail / Wizard Page
 * /health-safety/audits/[auditId]
 * For in-progress audits: shows the AuditWizard checklist
 * For completed audits: shows the read-only summary
 */

import type { NextPage } from 'next';
import type { GetServerSideProps } from 'next';
import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { AuditWizard } from '@/modules/health-safety/components/AuditWizard';

function AuditPageContent() {
  const router = useRouter();
  const { auditId } = router.query;

  if (!auditId || typeof auditId !== 'string') {
    return (
      <div className="p-8 text-center text-[var(--ff-text-secondary)]">
        Loading...
      </div>
    );
  }

  return (
    <AuditWizard
      auditId={auditId}
      onComplete={() => router.back()}
      onCancel={() => router.back()}
    />
  );
}

const AuditDetailPage: NextPage = () => {
  return (
    <AppLayout>
      <Head>
        <title>H&S Audit | FibreFlow</title>
      </Head>
      <ModulePage config={projectsConfig}>
        <AuditPageContent />
      </ModulePage>
    </AppLayout>
  );
};

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} };
};

export default AuditDetailPage;
