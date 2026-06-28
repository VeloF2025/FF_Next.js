import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { FnoAtlasDashboard } from '@/modules/fno-atlas/components/FnoAtlasDashboard';

const FnoAtlasPage: NextPage = () => {
  return (
    <AppLayout>
      <FnoAtlasDashboard />
    </AppLayout>
  );
};

export default FnoAtlasPage;
