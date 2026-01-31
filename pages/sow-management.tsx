import { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

const SOWManagement = dynamic(() => import('@/modules/projects/sow/SOWManagement').then(mod => mod.SOWManagement || mod.default), {
  ssr: false,
  loading: () => <div>Loading SOW management...</div>
});

export default function SOWManagementPage() {
  return <SOWManagement />;
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  return { props: {} };
};