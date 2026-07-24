import type { PhotoFlag } from '../types';

export function PhotoIntegrityList({ flags }: { flags: PhotoFlag[] }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-semibold">Photo integrity</h3>
      {flags.length === 0
        ? <p className="text-sm text-green-700">All referenced photos present in storage ✓</p>
        : (
          <ul className="text-sm text-red-700">
            {flags.map(f => (
              <li key={`${f.deltaId}-${f.photoKey}`} className="font-mono text-xs">
                {(f.label ?? f.featureKey)} → {f.photoKey} <span className="text-red-500">MISSING</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
