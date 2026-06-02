import { useRouter } from 'next/router';
import { CheckCircle } from 'lucide-react';

interface Props {
  uploadedCount: number;
}

export function SiteCamSuccess({ uploadedCount }: Props) {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <CheckCircle className="h-16 w-16 text-green-400" />
      <div>
        <h2 className="text-xl font-semibold text-neutral-100">All done!</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {uploadedCount} photo{uploadedCount !== 1 ? 's' : ''} uploaded successfully.
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={() => void router.push('/my/sitecam')}
          className="w-full rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 active:bg-sky-700"
        >
          Start Another Job
        </button>
        <button
          type="button"
          onClick={() => void router.push('/my')}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-3 text-sm font-medium text-neutral-300 hover:bg-neutral-800 active:bg-neutral-800/60"
        >
          Back to Hub
        </button>
      </div>
    </div>
  );
}
