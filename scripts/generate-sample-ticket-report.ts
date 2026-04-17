/**
 * Sample ticket report generator — writes the PDF for a given ticket UID
 * to /tmp so the visual can be inspected.
 *
 * Usage: npx tsx scripts/generate-sample-ticket-report.ts VF-20260417-018
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const args = process.argv.slice(2);
  const ticketUid = args.find((a) => !a.startsWith('--'));
  const regenerate = args.includes('--regenerate');
  if (!ticketUid) {
    console.error(
      'Usage: tsx scripts/generate-sample-ticket-report.ts <TICKET_UID> [--regenerate]'
    );
    process.exit(2);
  }

  const { queryOne } = await import('../src/modules/noc/utils/db');
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM maintenance_tickets WHERE ticket_uid = $1',
    [ticketUid]
  );

  if (!row) {
    console.error(`Ticket not found: ${ticketUid}`);
    process.exit(1);
  }

  const { buildTicketReportData } = await import('../src/modules/noc/services/ticketReportService');
  const { generateTicketReportPdf } = await import('../src/modules/noc/utils/ticketReportPdf');

  console.log(
    `Building report data for ${ticketUid} (${row.id})${regenerate ? ' [regenerating captions]' : ''}…`
  );
  const start = Date.now();
  const data = await buildTicketReportData(row.id, { regenerateCaptions: regenerate });
  console.log(
    `  data assembled in ${((Date.now() - start) / 1000).toFixed(1)}s — ${data.steps.length} steps, ${data.steps.reduce(
      (n, s) => n + s.photos.length,
      0
    ) + data.generalPhotos.length} photos, ${data.notes.length} notes`
  );

  const pdfStart = Date.now();
  const pdf = await generateTicketReportPdf(data);
  console.log(`  PDF rendered in ${((Date.now() - pdfStart) / 1000).toFixed(1)}s (${pdf.byteLength} bytes)`);

  const outPath = `/tmp/ticket-report-${ticketUid}.pdf`;
  await writeFile(outPath, pdf);
  console.log(`Wrote: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
