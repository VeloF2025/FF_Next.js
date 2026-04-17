/**
 * Activity Timeline Builder
 * Combines activity log entries with DR timestamp fields for a complete timeline
 */

import { log } from '@/lib/logger';
import { getActivityHistory } from './coreLogger';
import { getDb, EVENT_METADATA } from './_shared';
import type { ActivityEventType, TimelineEntry } from './_shared';

/**
 * Get activity timeline for UI display
 * Combines activity log entries with DR timestamp fields for a complete timeline
 *
 * @param drNumber - DR number
 * @param limit - Max entries to return
 * @returns Array of timeline entries formatted for UI
 */
export async function getActivityTimeline(
  drNumber: string,
  limit: number = 50
): Promise<TimelineEntry[]> {
  const sql = getDb();
  const timeline: TimelineEntry[] = [];

  // 1. Get activity log entries
  const history = await getActivityHistory(drNumber, limit);

  // 2. Collect UUIDs that need name lookup (for legacy records)
  const uuidsToLookup = new Set<string>();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const entry of history) {
    if (entry.event_type === 'human_review_completed') {
      const reviewer = entry.event_data?.reviewer;
      if (typeof reviewer === 'string' && uuidRegex.test(reviewer)) {
        uuidsToLookup.add(reviewer);
      }
    }
    // Also check actor field for UUID lookups
    if (entry.actor && uuidRegex.test(entry.actor)) {
      uuidsToLookup.add(entry.actor);
    }
  }

  // 3. Batch lookup user names for UUIDs
  const userNameMap = new Map<string, string>();
  if (uuidsToLookup.size > 0) {
    try {
      const uuidArray = Array.from(uuidsToLookup);
      const userRows = await sql`
        SELECT id::text, first_name, last_name FROM users WHERE id = ANY(${uuidArray}::uuid[])
      `;
      for (const row of userRows) {
        if (row.first_name || row.last_name) {
          userNameMap.set(row.id, [row.first_name, row.last_name].filter(Boolean).join(' '));
        }
      }
    } catch (err) {
      log.warn(`Could not batch lookup user names: ${err}`, undefined, 'ActivityLog');
    }
  }

  // 4. Build timeline entries with resolved names
  for (const entry of history) {
    const metadata = EVENT_METADATA[entry.event_type] || {
      title: entry.event_type,
      icon: '📌',
      iconColor: 'text-muted-foreground',
    };

    // Build description from event data
    let description = '';
    const data = entry.event_data;

    switch (entry.event_type) {
      case 'whatsapp_submitted':
        description = `Received from ${data.sender || 'unknown'} in ${data.group || 'unknown group'}`;
        break;
      case 'dr_acknowledged':
        description = `Acknowledgment sent with ${data.photoCount || 0} photos`;
        break;
      case 'photos_fetched':
        description = `${data.count || 0} photos from ${data.source || 'OneMap'}`;
        break;
      case 'PHOTOS_SYNCED':
        description = data.newPhotos
          ? `Synced ${data.newPhotos} new photos (${data.previousCount || 0} → ${data.newCount || 0})`
          : `${data.newCount || 0} photos synced from ${data.source || '1Map'}`;
        break;
      case 'attribute_categorized':
        description = `${data.categorized || 0}/${data.total || 0} photos categorized, ${data.needsVlm || 0} need VLM`;
        break;
      case 'vlm_qa_completed':
        description = `${data.passed || 0}/${data.total || 0} passed (${data.passRate || 0}%)`;
        break;
      case 'vlm_qa_failed':
        description = data.error ? String(data.error) : 'QA validation failed';
        break;
      case 'human_review_completed': {
        // Resolve reviewer name - check if it's a UUID and look it up
        let reviewerDisplay = data.reviewer || 'unknown';
        if (typeof reviewerDisplay === 'string' && uuidRegex.test(reviewerDisplay)) {
          reviewerDisplay = userNameMap.get(reviewerDisplay) || 'unknown';
        }
        // Also check reviewerId for legacy records
        if (reviewerDisplay === 'unknown' && data.reviewerId) {
          const reviewerId = String(data.reviewerId);
          if (uuidRegex.test(reviewerId)) {
            reviewerDisplay = userNameMap.get(reviewerId) || 'unknown';
          }
        }

        // Handle both old format (approved/rejected counts) and new format (stepsApproved array)
        let approvedCount = 0;
        let rejectedCount = 0;
        if (data.stepsApproved && Array.isArray(data.stepsApproved)) {
          approvedCount = data.stepsApproved.length;
          rejectedCount = 10 - approvedCount;
        } else {
          approvedCount = Number(data.approved) || 0;
          rejectedCount = Number(data.rejected) || 0;
        }

        // Include decision if present
        const decisionText = data.decision ? ` Decision: ${data.decision}.` : '';
        description = `Reviewed by ${reviewerDisplay}.${decisionText} ${approvedCount} steps approved, ${rejectedCount} steps missing`;
        break;
      }
      case 'step_approved':
        description = `Step ${data.step}: ${data.stepLabel || ''}`;
        break;
      case 'step_rejected':
        description = `Step ${data.step}: ${data.reason || 'No reason provided'}`;
        break;
      case 'feedback_sent':
        description = `Sent to ${data.group || 'WhatsApp group'}`;
        break;
      case 'error':
        description = data.message ? String(data.message) : 'An error occurred';
        break;
      case 'SERIAL_UPDATE':
        description = data.details ? String(data.details) : 'Serial number was updated';
        break;
      case 'SWAP_DETECTED':
        description = data.details ? String(data.details) : 'ONT and UPS serials appear swapped';
        break;
      case 'INSTALLATION_MISMATCH':
        description = data.details ? String(data.details) : '1Map serial differs from OES activated serial';
        break;
      case 'SERIAL_VERIFICATION_COMPUTED':
        description = data.details ? String(data.details) : `Verification: ${data.status || 'computed'}`;
        break;
      case 'WA_PHOTO_VLM_PROCESSED':
        description = data.match_status === 'match'
          ? `Serial confirmed from photo (${data.confidence || 0}% confidence)`
          : data.match_status === 'mismatch'
            ? `Serial MISMATCH detected from photo vs 1Map`
            : `Serial extracted from WA photo (${data.confidence || 0}% confidence)`;
        break;
      case 'SERIAL_CONFIRMED':
        description = data.details ? String(data.details) : 'Serial confirmed from multiple sources';
        break;
      case 'SERIAL_VERIFIED':
        description = data.details ? String(data.details) : '1Map serial verified correct';
        break;
      case 'INVESTIGATE':
        description = data.details ? String(data.details) : 'Needs manual investigation';
        break;
      case 'MANUAL_SERIAL_EDIT':
        description = data.details ? String(data.details) : 'Serial manually edited';
        break;

      // ── Action Centre events (RFC Phase 2) ──
      case 'non_invoiceable_flagged': {
        const note = data.noteCode ? String(data.noteCode).toUpperCase() : 'note';
        const week = data.weekEnding ? String(data.weekEnding).slice(0, 10) : 'unknown week';
        const team = data.team ? ` · team ${data.team}` : '';
        description = `${note} on week ${week}${team}`;
        break;
      }
      case 'non_invoiceable_resolved': {
        const note = data.noteCode ? String(data.noteCode).toUpperCase() : 'note';
        const reason = data.resolutionReason ? String(data.resolutionReason) : 'resolved';
        description = `${note} ${reason}`;
        break;
      }
      case 'pre_prov_added':
        description = `Pre-provisioned serial ${data.serial || 'unknown'}${data.project ? ` (${data.project})` : ''}`;
        break;
      case 'pre_prov_resolved': {
        const reason = data.resolutionReason ? String(data.resolutionReason) : 'resolved';
        const date = data.activationDate ? ` on ${String(data.activationDate).slice(0, 10)}` : '';
        description = `Pre-prov ${reason}${date}`;
        break;
      }
      case 'ticket_created': {
        const uid = data.ticketUid ? String(data.ticketUid) : 'ticket';
        const cat = data.category ? ` · ${data.category}` : '';
        const prio = data.priority && data.priority !== 'normal' ? ` · ${data.priority}` : '';
        description = `${uid}${cat}${prio}`;
        break;
      }
      case 'ticket_status_changed': {
        const uid = data.ticketUid ? String(data.ticketUid) : 'ticket';
        description = `${uid}: ${data.fromStatus || '?'} → ${data.toStatus || '?'}`;
        break;
      }
      case 'ticket_auto_closed': {
        const uid = data.ticketUid ? String(data.ticketUid) : 'ticket';
        description = `${uid} auto-closed (${data.ruleName || 'rule'})`;
        break;
      }
      case 'serial_reconciled': {
        const oldV = data.oldValue ? String(data.oldValue) : '(empty)';
        const newV = data.newValue ? String(data.newValue) : '?';
        const match = data.matchesOes ? ' · matches OES' : '';
        description = `prop ${data.propId}: ${oldV} → ${newV}${match}`;
        break;
      }
      case '1map_write_rejected':
        description = data.reason
          ? `${data.reason} (prop ${data.propId ?? 'unknown'})`
          : `1Map rejected write on prop ${data.propId ?? 'unknown'}`;
        break;
      case 'anomaly_fixed_still_billed': {
        const note = data.noteCode ? String(data.noteCode).toUpperCase() : 'note';
        const weeks = data.weeksSinceFix ?? '?';
        description = `${note} still billing ${weeks} week(s) after we fixed it — dispute candidate`;
        break;
      }
      case 'anomaly_persistent_note': {
        const note = data.noteCode ? String(data.noteCode).toUpperCase() : 'note';
        const weeks = data.consecutiveWeeks ?? '?';
        description = `${note} flagged for ${weeks} consecutive weeks — needs escalation`;
        break;
      }
      case 'maintenance_reopened': {
        const uid = data.ticketUid ? String(data.ticketUid) : 'ticket';
        const days = data.daysSinceResolved ?? '?';
        description = `${uid} reopened after ${days} day(s)`;
        break;
      }

      default:
        description = JSON.stringify(data).slice(0, 100);
    }

    // Resolve actor name if it's a UUID
    let actorDisplay = entry.actor;
    if (actorDisplay && uuidRegex.test(actorDisplay)) {
      actorDisplay = userNameMap.get(actorDisplay) || actorDisplay;
    }

    timeline.push({
      id: entry.id,
      timestamp: entry.created_at,
      eventType: entry.event_type,
      title: metadata.title,
      description,
      icon: metadata.icon,
      iconColor: metadata.iconColor,
      actor: actorDisplay,
      metadata: entry.event_data,
    });
  }

  // 2. Get DR timestamps from dr_photo_unified_reviews
  log.info(`Querying DR timestamps for ${drNumber}`, undefined, 'ActivityLog');
  try {
    const drRows = await sql`
      SELECT
        wa_received_at,
        whatsapp_submitted_at,
        acknowledged_at,
        photos_fetched_at,
        vlm_categorized_at,
        ai_evaluated_at,
        vlm_qa_validated_at,
        human_review_completed_at,
        qa_decision_at,
        qa_decision,
        qa_decision_by,
        feedback_sent_at,
        serial_swap_detected_at,
        serial_swap_corrected_at,
        last_resubmitted_at,
        photo_count,
        sender_phone,
        project
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber}
    `;

    log.info(`DR query returned ${drRows.length} rows for ${drNumber}`, undefined, 'ActivityLog');
    if (drRows.length > 0) {
      const dr = drRows[0]! as Record<string, unknown>;
      log.info(`DR timestamps: wa_received=${dr.wa_received_at}, vlm_cat=${dr.vlm_categorized_at}`, undefined, 'ActivityLog');

      // Add events from DR timestamps (only if not already in activity log)
      const existingEventTypes = new Set(history.map(h => h.event_type));

      // WhatsApp Received
      if (dr.wa_received_at && !existingEventTypes.has('whatsapp_submitted')) {
        timeline.push({
          id: `dr-wa-received-${drNumber}`,
          timestamp: new Date(String(dr.wa_received_at)),
          eventType: 'whatsapp_submitted',
          title: '📱 DR Submitted via WhatsApp',
          description: dr.sender_phone ? `From ${dr.sender_phone}` : 'Received via WhatsApp',
          icon: '📱',
          iconColor: 'text-green-500',
          actor: 'whatsapp',
          metadata: { source: 'dr_record', sender: dr.sender_phone },
        });
      }

      // Acknowledgment sent
      if (dr.acknowledged_at && !existingEventTypes.has('dr_acknowledged')) {
        timeline.push({
          id: `dr-ack-${drNumber}`,
          timestamp: new Date(String(dr.acknowledged_at)),
          eventType: 'dr_acknowledged',
          title: '✓ Acknowledgment Sent',
          description: dr.photo_count ? `${dr.photo_count} photos received` : 'DR acknowledged',
          icon: '✓',
          iconColor: 'text-blue-500',
          actor: 'system',
          metadata: { source: 'dr_record', photoCount: dr.photo_count },
        });
      }

      // Photos fetched
      if (dr.photos_fetched_at && !existingEventTypes.has('photos_fetched')) {
        timeline.push({
          id: `dr-photos-${drNumber}`,
          timestamp: new Date(String(dr.photos_fetched_at)),
          eventType: 'photos_fetched',
          title: '📷 Photos Fetched',
          description: dr.photo_count ? `${dr.photo_count} photos from OneMap` : 'Photos fetched from OneMap',
          icon: '📷',
          iconColor: 'text-purple-500',
          actor: 'system',
          metadata: { source: 'dr_record', count: dr.photo_count },
        });
      }

      // VLM Categorization
      if (dr.vlm_categorized_at && !existingEventTypes.has('attribute_categorized')) {
        timeline.push({
          id: `dr-categorized-${drNumber}`,
          timestamp: new Date(String(dr.vlm_categorized_at)),
          eventType: 'attribute_categorized',
          title: '🏷️ AI Photo Categorization',
          description: 'Photos categorized by VLM',
          icon: '🏷️',
          iconColor: 'text-indigo-500',
          actor: 'vlm',
          metadata: { source: 'dr_record' },
        });
      }

      // AI Data Extraction
      if (dr.ai_evaluated_at) {
        timeline.push({
          id: `dr-ai-eval-${drNumber}`,
          timestamp: new Date(String(dr.ai_evaluated_at)),
          eventType: 'vlm_qa_completed',
          title: '🔍 AI Data Extraction',
          description: 'Power meter, serials extracted by VLM',
          icon: '🔍',
          iconColor: 'text-yellow-500',
          actor: 'vlm',
          metadata: { source: 'dr_record' },
        });
      }

      // VLM QA Validation
      if (dr.vlm_qa_validated_at) {
        timeline.push({
          id: `dr-vlm-qa-${drNumber}`,
          timestamp: new Date(String(dr.vlm_qa_validated_at)),
          eventType: 'vlm_qa_completed',
          title: '✅ VLM QA Validated',
          description: 'Automated QA validation completed',
          icon: '✅',
          iconColor: 'text-green-500',
          actor: 'vlm',
          metadata: { source: 'dr_record' },
        });
      }

      // Human Review Completed
      if (dr.human_review_completed_at && !existingEventTypes.has('human_review_completed')) {
        timeline.push({
          id: `dr-human-review-${drNumber}`,
          timestamp: new Date(String(dr.human_review_completed_at)),
          eventType: 'human_review_completed',
          title: '👤 Human Review Completed',
          description: 'Photo assignments reviewed by QA team',
          icon: '👤',
          iconColor: 'text-blue-500',
          actor: 'qa_team',
          metadata: { source: 'dr_record' },
        });
      }

      // QA Decision (Final)
      if (dr.qa_decision_at && dr.qa_decision) {
        const isAutoQa = typeof dr.qa_decision_by === 'string' && dr.qa_decision_by.startsWith('system:');
        const decisionIcon = dr.qa_decision === 'PASS' ? '✅' : dr.qa_decision === 'FAIL' ? '❌' : '🔄';
        const decisionColor = dr.qa_decision === 'PASS' ? 'text-green-500' : dr.qa_decision === 'FAIL' ? 'text-red-500' : 'text-orange-500';
        timeline.push({
          id: `dr-decision-${drNumber}`,
          timestamp: new Date(String(dr.qa_decision_at)),
          eventType: isAutoQa ? 'AUTO_QA_COMPLETED' : 'human_review_completed',
          title: isAutoQa
            ? `${decisionIcon} Auto-QA Decision: ${dr.qa_decision}`
            : `${decisionIcon} Final Decision: ${dr.qa_decision}`,
          description: isAutoQa ? 'Automated QA decision (pending human review)' : 'QA decision recorded',
          icon: decisionIcon,
          iconColor: decisionColor,
          actor: isAutoQa ? 'system' : 'qa_team',
          metadata: { source: 'dr_record', decision: dr.qa_decision, decidedBy: dr.qa_decision_by },
        });
      }

      // Feedback Sent
      if (dr.feedback_sent_at && !existingEventTypes.has('feedback_sent')) {
        timeline.push({
          id: `dr-feedback-${drNumber}`,
          timestamp: new Date(String(dr.feedback_sent_at)),
          eventType: 'feedback_sent',
          title: '📤 WhatsApp Feedback Sent',
          description: 'QA feedback sent to technician',
          icon: '📤',
          iconColor: 'text-green-500',
          actor: 'system',
          metadata: { source: 'dr_record' },
        });
      }

      // Serial Swap Detected
      if (dr.serial_swap_detected_at && !existingEventTypes.has('SWAP_DETECTED')) {
        timeline.push({
          id: `dr-swap-detected-${drNumber}`,
          timestamp: new Date(String(dr.serial_swap_detected_at)),
          eventType: 'SWAP_DETECTED',
          title: '⚠️ Serial Swap Detected',
          description: 'ONT and UPS serials appear swapped',
          icon: '⚠️',
          iconColor: 'text-red-500',
          actor: 'system',
          metadata: { source: 'dr_record' },
        });
      }

      // Serial Swap Corrected
      if (dr.serial_swap_corrected_at) {
        timeline.push({
          id: `dr-swap-fixed-${drNumber}`,
          timestamp: new Date(String(dr.serial_swap_corrected_at)),
          eventType: 'SWAP_DETECTED',
          title: '✅ Serial Swap Corrected',
          description: 'Technician fixed the swapped serials in 1Map',
          icon: '✅',
          iconColor: 'text-green-500',
          actor: 'technician',
          metadata: { source: 'dr_record', corrected: true },
        });
      }

      // Resubmission
      if (dr.last_resubmitted_at) {
        timeline.push({
          id: `dr-resubmit-${drNumber}`,
          timestamp: new Date(String(dr.last_resubmitted_at)),
          eventType: 'whatsapp_submitted',
          title: '🔄 DR Resubmitted',
          description: 'Additional photos submitted',
          icon: '🔄',
          iconColor: 'text-orange-500',
          actor: 'whatsapp',
          metadata: { source: 'dr_record', resubmission: true },
        });
      }
    }
  } catch (error) {
    log.warn(`Failed to get DR timestamps for ${drNumber}: ${error}`, undefined, 'ActivityLog');
  }

  // 3. Get OES activation data
  try {
    const oesRows = await sql`
      SELECT activation_date, serial_number, team, ont_rx_sig_dbm
      FROM oes_activations
      WHERE drop_number = ${drNumber}
      LIMIT 1
    `;

    if (oesRows.length > 0) {
      const oes = oesRows[0]! as Record<string, unknown>;
      if (oes.activation_date) {
        timeline.push({
          id: `oes-activation-${drNumber}`,
          timestamp: new Date(String(oes.activation_date)),
          eventType: 'feedback_sent' as ActivityEventType, // Using closest event type
          title: '⚡ OES Activation',
          description: `Activated by ${oes.team || 'OES'} - Serial: ${oes.serial_number || 'N/A'}`,
          icon: '⚡',
          iconColor: 'text-yellow-500',
          actor: typeof oes.team === 'string' ? oes.team : 'oes',
          metadata: {
            source: 'oes_activations',
            serial: oes.serial_number,
            team: oes.team,
            rxPower: oes.ont_rx_sig_dbm,
          },
        });
      }
    }
  } catch (error) {
    log.warn(`Failed to get OES data for ${drNumber}: ${error}`, undefined, 'ActivityLog');
  }

  // Sort by timestamp descending (most recent first)
  timeline.sort((a, b) => {
    const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
    const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  return timeline.slice(0, limit);
}
