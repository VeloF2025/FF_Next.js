import { Loader2, Save } from 'lucide-react';

interface GalleryHeaderProps {
  viewMode: 'grid' | 'single';
  onSetViewMode: (mode: 'grid' | 'single') => void;
  goodCount: number;
  badCount: number;
  onCopyResults: () => void;
  /** Decisions made for the current step that haven't been persisted yet. */
  unsavedCount: number;
  saving: boolean;
  saveResult: { saved: number; good: number; bad: number } | null;
  saveError: string | null;
  onSaveDecisions: () => void;
}

/** Page header: title, grid/single toggle, Save to VLM Learning, and Copy Results. */
export function GalleryHeader({
  viewMode,
  onSetViewMode,
  goodCount,
  badCount,
  onCopyResults,
  unsavedCount,
  saving,
  saveResult,
  saveError,
  onSaveDecisions,
}: GalleryHeaderProps) {
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
          {saveError && <span className="text-sm text-red-400">{saveError}</span>}
          {saveResult && (
            <span className="text-sm text-green-400">
              ✓ Saved {saveResult.saved} ({saveResult.good}✅ {saveResult.bad}❌)
            </span>
          )}
          {unsavedCount > 0 && (
            <button
              onClick={onSaveDecisions}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save {unsavedCount} decision{unsavedCount !== 1 ? 's' : ''}
            </button>
          )}
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
