/**
 * Static go-live checklist for the WhatsApp Cloud provider.
 *
 * Deliberately static: these are manual, out-of-band steps (Meta dashboard,
 * credential entry, live send/receive test) that the app cannot observe, so
 * showing an auto-derived "done" tick here would be a lie. The only machine-
 * checked facts live in the readiness panel above the list.
 */

export interface WaGoLiveChecklistItem {
  id: string;
  title: string;
  detail: string;
}

export const WA_GO_LIVE_CHECKLIST: WaGoLiveChecklistItem[] = [
  {
    id: 'creds',
    title: 'Enter the four Cloud credentials',
    detail:
      'cloud_phone_number_id, cloud_access_token, cloud_app_secret and cloud_verify_token in wa_service_config. The readiness panel above shows which are still missing.',
  },
  {
    id: 'webhook',
    title: 'Point the Meta webhook at FibreFlow',
    detail:
      'Callback URL /api/communications/whatsapp/cloud-webhook, verify token = cloud_verify_token. Confirm Meta reports the GET handshake as verified.',
  },
  {
    id: 'subscribe',
    title: 'Subscribe the app to the messages field',
    detail:
      'In the Meta app dashboard, subscribe to "messages" so both inbound messages and delivery status callbacks arrive.',
  },
  {
    id: 'test-send',
    title: 'Run a Cloud test send',
    detail:
      'Use the test send below to prove the credentials work end to end. It sends on the Cloud channel only and does not change the active provider.',
  },
  {
    id: 'inbound',
    title: 'Confirm an inbound reply lands on a ticket',
    detail:
      'Reply to the test message from the same handset and check it appears in the NOC ticket WhatsApp panel. Inbound linking requires the sender number to match the ticket client contact.',
  },
  {
    id: 'flip',
    title: 'Flip wa_provider to cloud',
    detail:
      'Super admin only, and only once the steps above pass. Group messages keep using the bridge regardless — the Cloud API is 1:1 only.',
  },
];
