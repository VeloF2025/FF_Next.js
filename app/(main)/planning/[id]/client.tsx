'use client';
import { useParams } from 'next/navigation';
import { ProtectedPage } from '@/components/PermissionGate';
import { PlanningItemDetail } from '@/modules/planning/components/PlanningItemDetail';

export default function PlanningDetailClient() {
  const params = useParams();
  const id = params?.id as string;
  return (
    <ProtectedPage permission="planning.main" action="view">
      <div className="p-6"><PlanningItemDetail itemId={id} /></div>
    </ProtectedPage>
  );
}
