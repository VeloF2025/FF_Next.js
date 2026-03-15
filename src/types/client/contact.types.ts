/**
 * Client Contact History Types
 * Communication tracking and interaction types
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

import { ContactMethod, ContactPurpose, ContactOutcome } from './enums';

export interface ContactHistory {
  id?: string;
  clientId: string;
  contactDate: Timestamp;
  contactMethod: ContactMethod;
  contactedBy: string;
  contactedByName: string;
  purpose: ContactPurpose;
  summary: string;
  outcome: ContactOutcome;
  nextAction?: string;
  nextActionDate?: Timestamp;
  attachments?: string[];
  createdAt: Timestamp;
}