import { AppLayout } from '@/components/layout/AppLayout';
import { PendingActionItems } from '@/modules/action-items/pages/PendingActionItems';
import { CompletedActionItems } from '@/modules/action-items/pages/CompletedActionItems';
import { OverdueActionItems } from '@/modules/action-items/pages/OverdueActionItems';
import { ActionItemsByMeeting } from '@/modules/action-items/pages/ActionItemsByMeeting';
import { ActionItemsByAssignee } from '@/modules/action-items/pages/ActionItemsByAssignee';
import { ActionItemsSearch } from '@/modules/action-items/pages/ActionItemsSearch';
import { MyActionItems } from '@/modules/action-items/pages/MyActionItems';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const components = {
  'my-actions': MyActionItems,
  pending: PendingActionItems,
  completed: CompletedActionItems,
  overdue: OverdueActionItems,
  'by-meeting': ActionItemsByMeeting,
  'by-assignee': ActionItemsByAssignee,
  search: ActionItemsSearch,
};

export default function ActionItemsSubPage() {
  const router = useRouter();
  const { slug } = router.query;
  const [Component, setComponent] = useState<any>(null);

  useEffect(() => {
    if (slug && typeof slug === 'string') {
      const comp = components[slug as keyof typeof components];
      setComponent(() => comp);
    }
  }, [slug]);

  if (!Component) {
    return (
      <AppLayout>
        <div className="p-6">
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Page Not Found</h1>
          <p className="text-[var(--ff-text-secondary)] mt-2">The action items page you&apos;re looking for doesn&apos;t exist.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
