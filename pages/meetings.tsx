import type { GetServerSideProps } from 'next';

// Redirect /meetings → /communications?tab=meetings (Communications Portal has better UX)
export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/communications?tab=meetings',
      permanent: true,
    },
  };
};

export default function MeetingsPage() {
  // This component never renders — getServerSideProps always redirects
  return null;
}
