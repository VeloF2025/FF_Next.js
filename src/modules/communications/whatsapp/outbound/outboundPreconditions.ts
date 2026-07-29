import { createLogger } from '@/lib/logger';
import { getConsentForMsisdn } from '../consent/consentRepo';
import { extractMsisdnFromContact } from '../utils/phone';
import { getSendableTemplate, renderTemplate, type TemplateVariableName } from './approvedTemplates';
import { getTicketOutboundContext } from './ticketOutboundContext';

const logger = createLogger('wa:outbound-preconditions');

// Every WhatsApp conversation here is business-initiated: the FNO raises the
// ticket and Velocity contacts the subscriber first. That means Meta requires an
// approved template and prior opt-in, and POPIA requires we can prove the
// opt-in. #2276 is the code that makes the contractual clause real — a warranty
// the send path does not enforce is worth nothing.
//
// This module is the single place those checks live. It fails closed: the only
// path to `allowed: true` is one where every value the message needs is present
// and non-blank.

export type OutboundBlockReason =
  /** Missing, or not normalisable to a South African MSISDN. */
  | 'no_contact_number'
  /** Caller asked to message a number that is not this ticket's subscriber. */
  | 'contact_mismatch'
  /** No consent row exists for this MSISDN. */
  | 'no_consent'
  /** Consent was granted and later withdrawn. */
  | 'consent_withdrawn'
  /** resolveFnoForTicket found no FNO to attribute the message to. */
  | 'fno_unresolved'
  /** No approved template for the event type. */
  | 'no_approved_template'
  /** The template is approved but the ticket cannot fill one of its variables. */
  | 'template_variables_missing'
  /** The checks could not be completed — DB failure, missing ticket, or a bug. */
  | 'precondition_check_failed';

export type OutboundPreconditionResult =
  | {
      allowed: true;
      msisdn: string;
      fno: string;
      templateKey: string;
      /**
       * The rendered body to send. The caller sends THIS and nothing else — it is the
       * approved copy with ticket-derived variables filled in, so no caller-supplied
       * text can reach the provider.
       */
      message: string;
    }
  | {
      allowed: false;
      reasons: OutboundBlockReason[];
      /** Which template variables the ticket could not fill, when that was the block. */
      missingVariables?: readonly TemplateVariableName[];
    };

export interface OutboundPreconditionInput {
  ticketId: string;
  /** Template the caller intends to send. Unlisted or absent is a block. */
  templateKey?: string | null;
  /**
   * Number the caller asked to message, when it supplies one. It does not
   * choose the recipient — the ticket does — but a value disagreeing with the
   * ticket's subscriber blocks rather than being silently ignored.
   */
  requestedPhone?: string | null;
}

// Reported in a fixed order so the reason list is a property of what is wrong,
// not of the order the checks happened to run in.
const REASON_ORDER: readonly OutboundBlockReason[] = [
  'no_contact_number',
  'contact_mismatch',
  'no_consent',
  'consent_withdrawn',
  'fno_unresolved',
  'no_approved_template',
  'template_variables_missing',
  'precondition_check_failed',
];

function blocked(
  reasons: ReadonlySet<OutboundBlockReason>,
  missingVariables?: readonly TemplateVariableName[],
): OutboundPreconditionResult {
  const result: OutboundPreconditionResult = {
    allowed: false,
    reasons: REASON_ORDER.filter((r) => reasons.has(r)),
  };
  if (missingVariables && missingVariables.length > 0) {
    return { ...result, missingVariables };
  }
  return result;
}

/**
 * Evaluate every precondition for a business-initiated send.
 *
 * All four checks run and every failure is reported, rather than returning at
 * the first one: ops needs to see everything that is wrong about a ticket at
 * once instead of fixing one thing, retrying, and discovering the next.
 *
 * Any thrown error resolves to a block. Nothing propagates to the caller, so
 * there is no failure mode in which an exception leaves the send path free to
 * proceed.
 */
export async function evaluateOutboundPreconditions(
  input: OutboundPreconditionInput,
): Promise<OutboundPreconditionResult> {
  const reasons = new Set<OutboundBlockReason>();

  try {
    const context = await getTicketOutboundContext(input.ticketId);
    if (!context) {
      // No ticket, so nothing can be established about it. Reported as a failed
      // check rather than a specific precondition, because none of the four
      // were actually evaluated.
      logger.warn('outbound blocked: ticket not found', { ticketId: input.ticketId });
      return { allowed: false, reasons: ['precondition_check_failed'] };
    }

    // 1. Contact. The ticket decides who gets messaged; extractMsisdnFromContact
    // parses each phone-shaped run on its own instead of collapsing the whole
    // free-form field to digits, which would splice a street number onto a real
    // one and produce a plausible number belonging to nobody.
    const msisdn =
      extractMsisdnFromContact(context.clientContact) ??
      extractMsisdnFromContact(context.onemapContact);
    if (!msisdn) reasons.add('no_contact_number');

    if (input.requestedPhone != null) {
      const requested = extractMsisdnFromContact(input.requestedPhone);
      if (!requested) reasons.add('no_contact_number');
      else if (msisdn && requested !== msisdn) reasons.add('contact_mismatch');
    }

    // 2. FNO attribution.
    const fno = context.fno;
    if (!fno) reasons.add('fno_unresolved');

    // 3. Approved template, and the copy it actually sends. The template supplies the
    // body; the caller supplies neither text nor variables, so an approved key cannot
    // be used as cover for arbitrary free text.
    const template = getSendableTemplate(input.templateKey);
    let renderedMessage: string | null = null;
    let missingVariables: readonly TemplateVariableName[] | undefined;
    if (!template) {
      reasons.add('no_approved_template');
    } else {
      const render = renderTemplate(template, {
        clientName: context.clientName,
        fno: context.fno,
        address: context.address,
        drNumber: context.drNumber,
        loggedAt: context.loggedAt,
        dueAt: context.dueAt,
        resolvedAt: context.resolvedAt,
      });
      if (render.rendered) {
        renderedMessage = render.rendered.message;
      } else {
        // The template is approved but this ticket cannot fill it. Blocked rather than
        // sent with a gap: a message reading "the fault at  has been resolved" is worse
        // than none, and #2276 requires a blank variable to refuse.
        reasons.add('template_variables_missing');
        missingVariables = render.missing;
      }
    }

    // 4. Consent, which is keyed on the MSISDN. Without a number there is no key
    // to look up, and no row can exist — so "no consent" is the literal truth
    // here, not an inference, and it is reported alongside the missing contact.
    if (msisdn) {
      const consent = await getConsentForMsisdn(msisdn);
      if (consent.status === 'withdrawn') reasons.add('consent_withdrawn');
      else if (consent.status !== 'granted') reasons.add('no_consent');
    } else {
      reasons.add('no_consent');
    }

    // The trailing conditions are unreachable given the checks above, and are kept
    // because they make "never send a blank value" a property of the type rather than of
    // the reader's care: the success branch cannot be reached with an empty string or a
    // null in it.
    if (reasons.size > 0 || !msisdn || !fno || !template || !renderedMessage) {
      if (reasons.size === 0) reasons.add('precondition_check_failed');
      return blocked(reasons, missingVariables);
    }

    return {
      allowed: true,
      msisdn,
      fno,
      templateKey: template.key,
      message: renderedMessage,
    };
  } catch (error) {
    logger.error('outbound precondition check failed', {
      ticketId: input.ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail closed. Any accumulated reasons are kept so a DB failure part-way
    // through does not erase what was already known to be wrong.
    reasons.add('precondition_check_failed');
    return blocked(reasons);
  }
}
