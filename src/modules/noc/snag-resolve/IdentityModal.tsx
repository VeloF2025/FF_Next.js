/**
 * "Who are you?" identity capture modal for the public snag/resolve page.
 *
 * Field worker enters name + WhatsApp number (required) and company
 * (optional) before performing any write action. The values are stamped
 * on every photo upload and step completion via the actor_id FK chain.
 *
 * Error rendering is inline (not on the page below the overlay) so a
 * failing register_actor POST is actually visible — see PR #1731.
 */

import type { IdentityFormState } from './types';

interface IdentityModalProps {
  form: IdentityFormState;
  onChange: (next: IdentityFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  actionLoading: boolean;
  error: string | null;
}

export function IdentityModal({
  form,
  onChange,
  onSubmit,
  onCancel,
  actionLoading,
  error,
}: IdentityModalProps) {
  const submitDisabled = actionLoading || !form.name.trim() || !form.phone.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form
        className="w-full max-w-md rounded-lg bg-zinc-900 border border-zinc-700 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h3 className="text-base font-semibold text-zinc-100 mb-1">Who are you?</h3>
        <p className="text-xs text-zinc-400 mb-4">
          We need your details before you can start work. Stamped on every photo and step you complete.
        </p>
        {error && (
          <div
            role="alert"
            className="mb-3 rounded-md bg-red-900/20 border border-red-700/40 px-4 py-3 text-xs text-red-300"
          >
            {error}
          </div>
        )}
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-zinc-300">Your name *</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              className="mt-1 w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500"
              placeholder="e.g. Sipho Nkosi"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-300">WhatsApp number *</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => onChange({ ...form, phone: e.target.value })}
              className="mt-1 w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500"
              placeholder="e.g. 082 123 4567"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-300">Company (optional)</span>
            <input
              type="text"
              value={form.company}
              onChange={(e) => onChange({ ...form, company: e.target.value })}
              className="mt-1 w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500"
              placeholder="e.g. JK Civils"
            />
          </label>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={actionLoading}
            className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm rounded"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            className="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium text-sm rounded"
          >
            {actionLoading ? 'Saving…' : 'Save & Start Work'}
          </button>
        </div>
      </form>
    </div>
  );
}
