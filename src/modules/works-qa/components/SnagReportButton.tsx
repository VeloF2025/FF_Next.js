/**
 * SnagReportButton — context-aware split button that opens the
 * SnagReportScopeDialog. The primary label reflects the deepest scope
 * currently active in the URL (Pole > PON > Zone > Project). The
 * "Advanced ▾" sibling button opens the same dialog for full scope
 * customisation.
 *
 * // 🟢 WORKING: T9 — wires T8 dialog into WorksQAPage toolbar.
 */
import { useState } from 'react';
import { SnagReportScopeDialog } from './SnagReportScopeDialog';

/** Scope context derived from the page URL params. */
interface Ctx {
  zone_no?: number;
  pon_no?: number;
  pole_id?: string;
}

interface Props {
  projectId: string;
  ctx: Ctx;
}

/** Derives the context-aware button label from the deepest active scope. */
function labelFor(ctx: Ctx): string {
  if (ctx.pole_id) return 'Pole report';
  if (ctx.pon_no !== undefined) return 'PON report';
  if (ctx.zone_no !== undefined) return 'Zone report';
  return 'Project report';
}

export function SnagReportButton({ projectId, ctx }: Props) {
  const [open, setOpen] = useState(false);

  const openDialog = () => setOpen(true);
  const closeDialog = () => setOpen(false);

  return (
    <>
      <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
        <button
          type="button"
          onClick={openDialog}
          className="px-3 py-1.5 bg-slate-800 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
        >
          {labelFor(ctx)}
        </button>
        <button
          type="button"
          onClick={openDialog}
          aria-label="Advanced"
          className="px-2 py-1.5 bg-slate-800 border-l border-slate-700 text-sm text-slate-400 hover:bg-slate-700 transition-colors"
        >
          Advanced ▾
        </button>
      </div>

      <SnagReportScopeDialog
        open={open}
        projectId={projectId}
        defaultCtx={ctx}
        onClose={closeDialog}
      />
    </>
  );
}
