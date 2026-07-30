/**
 * H&S Upload Training Certificate
 * /health-safety/training/certificates/new
 *
 * The H&S entry point into the shared certificate workflow. Unlike the employee
 * profile it does not know who the certificate belongs to, so the form renders
 * employee selection; everything else is identical. No sidebar entry is added —
 * this is reached from the training index.
 */

import type { NextPage } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronLeft } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { TrainingCertificateUploadForm } from '@/modules/health-safety/components/training/TrainingCertificateUploadForm';

function UploadCertificateContent() {
  const router = useRouter();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/health-safety/training"
          className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
            Upload Training Certificate
          </h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            One certificate, one or more competencies. It counts once a verifier approves it.
          </p>
        </div>
      </div>

      <TrainingCertificateUploadForm
        onSuccess={() => router.push('/health-safety/training')}
        onCancel={() => router.push('/health-safety/training')}
      />
    </div>
  );
}

const UploadCertificatePage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Upload Training Certificate | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <UploadCertificateContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default UploadCertificatePage;
