export default function TestPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--ff-bg-tertiary)]">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-[var(--ff-text-primary)] mb-4">
          Test Page
        </h1>
        <p className="text-[var(--ff-text-secondary)]">
          If you can see this, Next.js is working!
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