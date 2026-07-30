import pool from '@/lib/db';
import { log } from '@/lib/logger';
import type { DeliveryActor } from '@/modules/construction-qa/zone-delivery/types/zoneDelivery.types';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import type { SnagStatus } from '@/modules/construction-qa/types/snag.types';
import { updateTicket } from '@/modules/noc/services/ticketService';
import { TicketStatus } from '@/modules/noc/types/ticket';

const zoneDeliveryService = createZoneDeliveryService(pool);

function ticketStatusFor(snagStatus: SnagStatus): TicketStatus | undefined {
  switch (snagStatus) {
    case 'in_progress': return TicketStatus.IN_PROGRESS;
    case 'pending_qa':
    case 'fixed': return TicketStatus.PENDING_QA;
    case 'resolved':
    case 'closed': return TicketStatus.RESOLVED;
    case 'verified': return TicketStatus.VERIFIED;
    default: return undefined;
  }
}

export async function runSnagStatusSideEffects(input: {
  snagId: string;
  previousStatus: string;
  requestedStatus?: SnagStatus;
  nocTicketId?: string | null;
  actor: DeliveryActor;
}): Promise<void> {
  const { snagId, previousStatus, requestedStatus, nocTicketId, actor } = input;
  if (requestedStatus && nocTicketId) {
    const ticketStatus = ticketStatusFor(requestedStatus);
    if (ticketStatus) {
      try {
        await updateTicket(nocTicketId, {
          status: ticketStatus,
          ...(ticketStatus === TicketStatus.RESOLVED && { resolved_at: new Date() }),
        });
        log.info('NOC ticket status synced', { snagId, ticketId: nocTicketId, ticketStatus });
      } catch (syncError) {
        log.error('Failed to sync NOC ticket status', {
          snagId,
          ticketId: nocTicketId,
          syncErr: syncError,
        });
      }
    }
  }
  if (!requestedStatus || requestedStatus === previousStatus) return;
  try {
    await zoneDeliveryService.recalculateForSnag(snagId, actor);
  } catch (recalculationError) {
    log.error('Zone delivery snag recalculation failed', {
      snagId,
      userId: actor.userId,
      error: recalculationError instanceof Error
        ? recalculationError.message
        : String(recalculationError),
    });
  }
}
