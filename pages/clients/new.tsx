import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ClientForm } from '../../src/modules/clients/components/ClientForm';

const ClientCreatePage: NextPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <ClientForm />
      </div>
    </AppLayout>
  );
};

export default ClientCreatePage;

// Prevent static generation to avoid router mounting issues
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};