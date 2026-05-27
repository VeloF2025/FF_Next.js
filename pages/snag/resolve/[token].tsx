/**
 * Public Snag Resolve Page — No auth required.
 *
 * Subcontractors open this from a WhatsApp share link to view the snag,
 * identify themselves, upload after-photos, and submit for QA. The page
 * is read-only when the ticket is not in assigned/in_progress status.
 *
 * Data + write actions live in useSnagResolve. UI chunks live under
 * src/modules/noc/snag-resolve/ — see Hard Rule 11 in CLAUDE.md.
 */

import { useRouter } from 'next/router';
import Head from 'next/head';
import { AlertTriangle, CheckCircle, ArrowRight, Lock, Upload, User } from 'lucide-react';
import { TicketStatus } from '@/modules/noc/types/ticket';
import { PageShell, DescriptionWithGPS } from '@/modules/noc/snag-resolve/PageShell';
import { IdentityModal } from '@/modules/noc/snag-resolve/IdentityModal';
import { VerificationStepList } from '@/modules/noc/snag-resolve/VerificationStepList';
import { STATUS_LABELS, STATUS_COLORS, STATUS_COLOR_FALLBACK } from '@/modules/noc/snag-resolve/session';
import { useSnagResolve } from '@/modules/noc/snag-resolve/useSnagResolve';

export default function SnagResolvePage() {
  const router = useRouter();
  const { token } = router.query;
  const tokenStr = typeof token === 'string' ? token : null;

  const {
    data, loading, error, actor, showIdentityModal, identityForm,
    actionLoading, uploadingStep,
    setShowIdentityModal, setIdentityForm,
    performAction, handlePhotoUpload, handleStartWork, handleIdentitySubmit, handleMarkComplete,
  } = useSnagResolve(tokenStr);

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 border-2 border-zinc-500 border-t-blue-400 rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }

  if (error && !data) {
    return (
      <PageShell>
        <div className="text-center py-16">
          <Lock className="w-12 h-12 text-zinc-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-zinc-200 mb-2">Link Not Found</h2>
          <p className="text-sm text-zinc-400">{error}</p>
        </div>
      </PageShell>
    );
  }

  if (!data) return null;

  const { ticket, canInteract, canStartWork, canSubmit, steps, beforePhotos } = data;

  return (
    <PageShell>
      <Head>
        <title>{ticket.ticket_uid} — Ticket Resolution | FibreFlow</title>
      </Head>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-zinc-100">{ticket.ticket_uid}</h1>
          <span className={`text-xs px-2 py-1 rounded border font-medium ${STATUS_COLORS[ticket.status] ?? STATUS_COLOR_FALLBACK}`}>
            {STATUS_LABELS[ticket.status] ?? ticket.status}
          </span>
        </div>
        <h2 className="text-sm text-zinc-300 mb-1">{ticket.title}</h2>
        {ticket.project_name && (
          <p className="text-xs text-zinc-500">Project: {ticket.project_name}</p>
        )}
        {actor && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1">
            <User className="w-3 h-3" />
            <span>Logged in as <span className="text-zinc-200">{actor.name}</span>{actor.company ? ` · ${actor.company}` : ''}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/20 border border-red-700/40 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {!canInteract && (
        <div className="mb-6 rounded-lg bg-zinc-800 border border-zinc-700 p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 text-zinc-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {ticket.status === TicketStatus.PENDING_QA ? 'Submitted for QA — awaiting review' :
               ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.VERIFIED ? 'This snag has been resolved' :
               'This ticket is currently read-only'}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {ticket.status === TicketStatus.PENDING_QA ? 'You will regain access if the QA review sends it back for rework.' :
               'Contact the project team if you need to make changes.'}
            </p>
          </div>
        </div>
      )}

      {canStartWork && (
        <div className="mb-6 rounded-lg bg-blue-900/20 border border-blue-700/40 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-blue-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-zinc-100 mb-2">Ready to Start?</h3>
          <p className="text-sm text-zinc-300 mb-4 max-w-md mx-auto">
            Review the snag details and before photo below, then click to begin work.
            You&apos;ll be able to complete verification steps and upload photos.
          </p>
          <button
            type="button"
            onClick={() => { void handleStartWork(); }}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            {actionLoading ? 'Starting...' : 'Start Work'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3">Snag Description</h3>
          <DescriptionWithGPS text={ticket.description} />
        </div>

        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-red-400 mb-3">Before Photo</h3>
          {beforePhotos.length > 0 ? (
            <a href={beforePhotos[0]?.photo_url} target="_blank" rel="noopener noreferrer">
              <img
                src={beforePhotos[0]?.thumbnail_url ?? beforePhotos[0]?.photo_url}
                alt="Before"
                className="w-full h-48 object-cover rounded-lg border-2 border-red-500/30"
              />
            </a>
          ) : (
            <div className="h-48 rounded-lg border-2 border-dashed border-zinc-600 flex items-center justify-center">
              <span className="text-xs text-zinc-500">No before photo available</span>
            </div>
          )}
        </div>
      </div>

      <VerificationStepList
        steps={steps}
        canInteract={canInteract}
        ticketStatus={ticket.status}
        uploadingStep={uploadingStep}
        actionLoading={actionLoading}
        hasActor={Boolean(actor)}
        onUpload={handlePhotoUpload}
        onMarkComplete={handleMarkComplete}
        onIdentityRequired={() => setShowIdentityModal(true)}
      />

      {showIdentityModal && (
        <IdentityModal
          form={identityForm}
          onChange={setIdentityForm}
          onSubmit={handleIdentitySubmit}
          onCancel={() => setShowIdentityModal(false)}
          actionLoading={actionLoading}
          error={error}
        />
      )}

      {canSubmit && (
        <div className="rounded-lg bg-green-900/20 border border-green-700/40 p-6 text-center">
          <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-zinc-100 mb-2">Work Complete?</h3>
          <p className="text-sm text-zinc-300 mb-4 max-w-md mx-auto">
            Submit this snag for QA review. Make sure you&apos;ve uploaded the after photo
            and completed all required steps.
          </p>
          <button
            type="button"
            onClick={() => { void performAction('submit_for_qa'); }}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {actionLoading ? 'Submitting...' : 'Submit for QA'}
          </button>
        </div>
      )}
    </PageShell>
  );
}
