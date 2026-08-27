/**
 * Legacy alias for POST /api/noc/wa-message.
 *
 * The Go WhatsApp bridge on the VPS still posts maintenance-group messages
 * to this path (renamed to /api/noc in 96d8cc941). Until the bridge binary
 * is rebuilt with the new URL, keep the old path serving the same handler.
 *
 * @module api/maintenance/wa-message
 */

export { default, config } from '../noc/wa-message';
