interface GalleryHeaderProps {
  viewMode: 'grid' | 'single';
  onSetViewMode: (mode: 'grid' | 'single') => void;
  goodCount: number;
  badCount: number;
  onCopyResults: () => void;
}

/** Page header: title, grid/single toggle, and the Copy Results action. */
export function GalleryHeader({ viewMode, onSetViewMode, goodCount, badCount, onCopyResults }: GalleryHeaderProps) {
  return (
    <div className="border-b border-gray-800 bg-gray-900 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Photo Criteria Review Gallery</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Review accepted photos per step. Mark ✅ GOOD to flag as a training example, ❌ BAD to flag as
            problematic.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-700 overflow-hidden text-sm">
            <button
              onClick={() => onSetViewMode('grid')}
              className={`px-3 py-1.5 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              Grid
            </button>
            <button
              onClick={() => onSetViewMode('single')}
              className={`px-3 py-1.5 ${viewMode === 'single' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              Single
            </button>
          </div>
          {(goodCount > 0 || badCount > 0) && (
            <button
              onClick={onCopyResults}
              className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600"
            >
              Copy Results ({goodCount}✅ {badCount}❌)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
