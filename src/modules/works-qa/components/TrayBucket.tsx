import { useRef } from 'react';

interface TrayBucketProps {
  trayKeys: string[];
  onUpload: (files: File[]) => void;
  disabled?: boolean;
}

export function TrayBucket({ trayKeys, onUpload, disabled }: TrayBucketProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) onUpload(files);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Tray Photos ({trayKeys.length})
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50"
        >
          + Add
        </button>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        className="border border-dashed border-zinc-700 rounded-lg p-3 min-h-16"
      >
        {trayKeys.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center pt-2">Drop tray photos here or click Add</p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {trayKeys.map((key, i) => (
              <img
                key={i}
                src={`/storage/${key}`}
                alt={`Tray ${i + 1}`}
                className="w-full h-16 object-cover rounded"
              />
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onUpload(files);
        }}
      />
    </div>
  );
}
