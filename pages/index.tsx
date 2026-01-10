import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to dashboard page on load
    router.push('/dashboard');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--ff-bg-secondary)]">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-[var(--ff-text-primary)] mb-4">
          FibreFlow Next.js
        </h1>
        <p className="text-[var(--ff-text-secondary)] mb-4">
          Enterprise fiber network project management
        </p>
        <p className="text-sm text-[var(--ff-text-tertiary)]">
          Redirecting to dashboard...
        </p>
      </div>
    </div>
  );
}

// Disable static generation for this page
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};