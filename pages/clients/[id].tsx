import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';

const ClientDetail = dynamic(
  () => import('../../src/modules/clients/components/ClientDetail').then(mod => mod.ClientDetail),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }
);

const ClientDetailPage: NextPage = () => {
  return (
    <AppLayout>
      <ClientDetail />
    </AppLayout>
  );
};

// Disable static generation to prevent Html import and router issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};

export default ClientDetailPage;