/**
 * CAPA (Corrective Actions) Page
 * /projects/health-safety/capa
 */

import type { NextPage } from 'next';
import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { projectsConfig } from '@/modules/navigation';
import { Plus } from 'lucide-react';
import { CAPAList, CAPAForm } from '@/modules/health-safety/components/capa';

function CAPAPageContent() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Corrective Actions</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Track and manage corrective & preventive actions across all H&S activities
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-primary-500)] hover:bg-[var(--ff-primary-600)] text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New CAPA
        </button>
      </div>

      <CAPAList
        onSelectCAPA={(id) => router.push(`/projects/health-safety/capa/${id}`)}
      />

      {showForm && (
        <CAPAForm
          onSuccess={() => {
            setShowForm(false);
            // SWR will auto-refresh
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

const CAPAPage: NextPage = () => (
  <AppLayout>
    <Head>
      <title>Corrective Actions | H&S | FibreFlow</title>
    </Head>
    <ModulePage config={projectsConfig}>
      <CAPAPageContent />
    </ModulePage>
  </AppLayout>
);

export const getServerSideProps = async () => ({ props: {} });

export default CAPAPage;
