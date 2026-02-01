/**
 * Activate - Technicians Page
 * 
 * Directory of field technicians (activators and installers)
 * with performance metrics and discovery from WhatsApp/OneMap.
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { TechnicianDirectory } from '@/modules/activate/components/TechnicianDirectory';

const TechniciansPage: NextPage = () => {
  const router = useRouter();

  const handleViewTechnician = (id: string) => {
    router.push(`/activate/technicians/${id}`);
  };

  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <TechnicianDirectory onViewTechnician={handleViewTechnician} />
      </ModulePage>
    </AppLayout>
  );
};

export default TechniciansPage;
