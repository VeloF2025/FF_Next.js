/**
 * Manual Ticket Creation Taxonomy
 *
 * Single source of truth for the (category, discipline) combinations a
 * manual form user can pick. Everything else (Non-Invoicable, Fibertime,
 * HSE near-miss, Sales/QContact auto-ingest, etc.) is auto-ingested from
 * SP / Weekly Imports / QContact / WhatsApp and must NOT appear in the
 * manual picker.
 *
 * Referenced by:
 * - CategorySection (form UI)
 * - useTicketForm.validateFormData (client validation)
 * - POST /api/noc/tickets (server validation — PR 3)
 *
 * Related:
 * - April-11 planning session with Hein (memory/project_noc_taxonomy_refactor.md)
 * - Migration 277 (rename sub_type→category, add team.discipline)
 * - Migration 278 (expand type CHECK to include 5 disciplines)
 */

import { TicketCategory, TicketType } from '../types/ticket';

/**
 * A single pickable (category, discipline) row in the manual form.
 *
 * On submit the form writes:
 *   source       = 'manual'  (always — derived, never picked by user)
 *   ticket_type  = row.ticket_type
 *   category     = row.category
 */
export interface ManualTaxonomyRow {
  /** T1 — what kind of ticket this is */
  category: TicketCategory;
  /** T2 — which discipline / team handles it (drives auto-assign) */
  ticket_type: TicketType;
  /** Human label for the discipline step. Shown in the radio group. */
  disciplineLabel: string;
}

/**
 * Every (category, ticket_type) pair a manual form user is allowed to pick.
 * Ordered alphabetically by category per the project's alphabetical-ordering
 * rule, with disciplines in the order civils → optical → activations.
 */
export const MANUAL_TICKET_TAXONOMY: readonly ManualTaxonomyRow[] = [
  // DevOps — single discipline (FibreFlow app issues)
  { category: TicketCategory.DEV_OPS, ticket_type: TicketType.DEV_OPS, disciplineLabel: 'DevOps' },

  // HSE — single option, maps to generic maintenance discipline
  // (HSE isn't its own discipline; an HSE ticket ends up on the maintenance team queue)
  { category: TicketCategory.HSE_INCIDENT, ticket_type: TicketType.MAINTENANCE, disciplineLabel: 'H&S' },

  // Maintenance — all three disciplines
  { category: TicketCategory.MAINTENANCE, ticket_type: TicketType.CIVILS,      disciplineLabel: 'Civils' },
  { category: TicketCategory.MAINTENANCE, ticket_type: TicketType.OPTICAL,     disciplineLabel: 'Optical' },
  { category: TicketCategory.MAINTENANCE, ticket_type: TicketType.ACTIVATIONS, disciplineLabel: 'Activations' },

  // Sales Lead — single option (manual entry; QContact auto-ingest is a separate path)
  { category: TicketCategory.SALES_LEAD, ticket_type: TicketType.MAINTENANCE, disciplineLabel: 'Lead' },

  // Snag — all three disciplines (Tera + WhatsApp-internal are auto-ingest only)
  { category: TicketCategory.SNAG, ticket_type: TicketType.CIVILS,      disciplineLabel: 'Civils' },
  { category: TicketCategory.SNAG, ticket_type: TicketType.OPTICAL,     disciplineLabel: 'Optical' },
  { category: TicketCategory.SNAG, ticket_type: TicketType.ACTIVATIONS, disciplineLabel: 'Activations' },

  // Unspecified — escape hatch, single option
  { category: TicketCategory.UNSPECIFIED, ticket_type: TicketType.MAINTENANCE, disciplineLabel: 'Unspecified' },
];

/**
 * Display label for each T1 category. Alphabetical.
 */
export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  [TicketCategory.DEV_OPS]:      'DevOps',
  [TicketCategory.HSE_INCIDENT]: 'H&S',
  [TicketCategory.MAINTENANCE]:  'Maintenance',
  [TicketCategory.SALES_LEAD]:   'Sales Lead',
  [TicketCategory.SNAG]:         'Snag',
  [TicketCategory.UNSPECIFIED]:  'Unspecified',
};

/**
 * Alphabetically-ordered list of categories for the card picker. Derived
 * from the taxonomy so the picker only shows categories that have at least
 * one pickable (category, discipline) row.
 */
export const MANUAL_CATEGORIES: readonly TicketCategory[] = Array.from(
  new Set(MANUAL_TICKET_TAXONOMY.map((row) => row.category))
).sort((a, b) => CATEGORY_LABELS[a].localeCompare(CATEGORY_LABELS[b]));

/**
 * Return every pickable discipline row for a given category.
 */
export function getDisciplinesForCategory(
  category: TicketCategory
): readonly ManualTaxonomyRow[] {
  return MANUAL_TICKET_TAXONOMY.filter((row) => row.category === category);
}

/**
 * Return true when the (category, ticket_type) pair is a valid manual
 * submission. Used by client-side form validation and (PR 3) by the
 * server-side validator in POST /api/noc/tickets.
 */
export function isValidManualTaxonomy(
  category: TicketCategory | string | null | undefined,
  ticket_type: TicketType | string | null | undefined
): boolean {
  if (!category || !ticket_type) return false;
  return MANUAL_TICKET_TAXONOMY.some(
    (row) => row.category === category && row.ticket_type === ticket_type
  );
}
