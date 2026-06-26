'use client';
import { useParams } from 'next/navigation';
import { PlanningItemDetail } from '@/modules/planning/components/PlanningItemDetail';

export default function PlanningDetailClient() {
  const params = useParams();
  const id = params?.id as string;
  return <div className="p-6"><PlanningItemDetail itemId={id} /></div>;
}
