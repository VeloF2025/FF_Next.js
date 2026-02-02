import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ClientForm } from '../../../src/modules/clients/components/ClientForm';

const ClientEditPage: NextPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <ClientForm />
      </div>
    </AppLayout>
  );
};

// Disable static generation to prevent Html import and router issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};

export default ClientEditPage;