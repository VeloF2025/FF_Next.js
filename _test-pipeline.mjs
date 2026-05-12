// Test full pipeline against all 3 sample sheets
import fs from 'node:fs';
import sharp from 'sharp';

const SHEETS = [
  '/home/hein/Downloads/WhatsApp Image 2026-05-12 at 16.07.52.jpeg',
  '/home/hein/Downloads/WhatsApp Image 2026-05-12 at 16.07.51.jpeg',
  '/home/hein/Downloads/WhatsApp Image 2026-05-12 at 12.27.05.jpeg',
];

function toStringOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}
function normalizeDrNumber(dr) {
  if (!dr) return null;
  let c = dr.replace(/\s+/g, '').toUpperCase();
  c = c.replace(/[O]/g, '0').replace(/[I]/g, '1').replace(/[S]/g, '5');
  if (c.startsWith('DR19')) c = 'DR18' + c.slice(4);
  if (c.startsWith('DR')) return c;
  if (/^\d{5,7}$/.test(c)) return `DR${c}`;
  return c;
}
function cleanOntSerial(s) { if (!s) return null; return s.toUpperCase().replace(/^SN:/, '').replace(/[\s-]/g, ''); }
function cleanGizzuSerial(s) {
  if (!s) return null;
  const x = s.toUpperCase().replace(/[\s]/g, '');
  if (x.startsWith('GU')) return x;
  if (/^-?\d{4,}$/.test(x)) return x;
  return null;
}
function validatePon(pon) {
  if (!pon) return null;
  const num = parseInt(pon.replace(/[^0-9]/g, ''), 10);
  if (num >= 100 && num <= 200) return num.toString();
  return null;
}
function postProcessEntries(entries) {
  return entries.map((entry) => {
    const addrStr = toStringOrNull(entry.address);
    return {
      ...entry,
      dr_number: normalizeDrNumber(toStringOrNull(entry.dr_number)),
      ont_serial: cleanOntSerial(toStringOrNull(entry.ont_serial)),
      gizzu_serial: cleanGizzuSerial(toStringOrNull(entry.gizzu_serial)),
      pon_number: validatePon(toStringOrNull(entry.pon_number)),
      address: addrStr ? (addrStr.replace(/[^0-9]/g, '') || null) : null,
    };
  });
}

const PROMPT = process.env.PROMPT_FILE
  ? fs.readFileSync(process.env.PROMPT_FILE, 'utf8')
  : `/no_think
Read this handwritten Velocity Fibre install form table.

HANDWRITING GUIDE for this writer:
- "6" written as round "0" shape → when you see "0" in DR numbers or addresses, it's "6"
- "8" written tall like "9" → in DR prefix, always "8" (DR186XXXX)
- "4" can look like "1" or "9" → in addresses starting with "14", second digit is always "4"

COLUMNS: Row# | ONT Serial (sticker "SN:ALCL...") | Gizzu (GU18W12V25-XXX-XXXXX) | DR (DR186XXXX) | PON | Address

DR Numbers: ALL start with DR186. The last 3-4 digits vary per row — read each carefully.
Addresses: ALL start with "14" followed by 3 unique digits. Examples from this area: 14643, 14627, 14813, 14814, 14897, 14898, 14846, 14812, 14832, 14825.
Gizzu suffixes: format is 3chars-5digits (like 090-30991 or 04C-31000). The suffix is different per row.
PON: one of 128, 127, or 121 — read the actual handwritten digits.

Date: top-right DD/MM/YYYY → YYYY-MM-DD.
Designation section at the bottom of the form has TWO rows:
- Row 1 label "Velocity Fibre" (or "VF") → velocity_rep_name + velocity_rep_id (VF supervisor)
- Row 2 label "Contractor" or "Technician" → technician_name + technician_id (contractor who did the work)
Read both names and IDs in full. If a row is blank, use null.

Each row is UNIQUE. Do NOT increment or copy values. Do NOT copy the placeholder tokens
below — they are SCHEMA hints (showing field names and types), not data. If you cannot
read a value, use null. Inventing plausible-looking serials is forbidden.

Return JSON matching this schema. Replace every <PLACEHOLDER> with the actual value
you read from the form, or null if illegible. Do NOT echo the placeholder strings.
{"date":"<YYYY-MM-DD>","velocity_rep_name":"<NAME_OR_NULL>","velocity_rep_id":"<ID_OR_NULL>","technician_name":"<NAME_OR_NULL>","technician_id":"<ID_OR_NULL>","entries":[{"row_number":<INT_FROM_1>,"ont_serial":"<ALCL_SERIAL_OR_NULL>","gizzu_serial":"<GU18W12V25_SERIAL_OR_NULL>","dr_number":"<DR186XXXX_OR_NULL>","pon_number":"<128_127_121_OR_NULL>","address":"<14XXX_OR_NULL>","confidence":<0_TO_1>}],"overall_confidence":<0_TO_1>}`;

async function extractOneSheet(sheetPath) {
  console.log(`\n${'='.repeat(80)}\nSHEET: ${sheetPath.split('/').pop()}\n${'='.repeat(80)}`);
  const buf = fs.readFileSync(sheetPath);
  const resized = await sharp(buf).rotate().resize(1280, 960, { fit: 'inside', withoutEnlargement: true }).normalise().jpeg({ quality: 92 }).toBuffer();
  const base64 = resized.toString('base64');

  const t0 = Date.now();
  const resp = await fetch('http://100.96.203.105:8100/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ',
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }] }],
      max_tokens: 4096,
      temperature: 0,
    }),
  });
  if (!resp.ok) { console.log('VLM HTTP ERROR:', resp.status, await resp.text()); return; }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  let jsonStr = content;
  const codeBlock = jsonStr.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (codeBlock) jsonStr = codeBlock[1];

  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch (e) { console.log('JSON PARSE FAILED:', e.message); console.log('Raw:', content.slice(0, 500)); return; }

  try { parsed.entries = postProcessEntries(parsed.entries); }
  catch (e) { console.log('POSTPROCESS FAILED:', e.message); return; }

  console.log(`OK in ${Date.now() - t0}ms`);
  console.log(`Date=${parsed.date} | VF="${parsed.velocity_rep_name}"/${parsed.velocity_rep_id} | Tech="${parsed.technician_name}"/${parsed.technician_id} | Conf=${parsed.overall_confidence}`);
  console.log('row | dr            | ont                | gizzu                         | pon | addr');
  parsed.entries.forEach((e) => {
    console.log(`${String(e.row_number).padEnd(3)} | ${String(e.dr_number || '').padEnd(13)} | ${String(e.ont_serial || '').padEnd(18)} | ${String(e.gizzu_serial || '').padEnd(29)} | ${String(e.pon_number || '').padEnd(3)} | ${e.address || ''}`);
  });
}

for (const sheet of SHEETS) {
  try { await extractOneSheet(sheet); }
  catch (e) { console.log(`Error on ${sheet}:`, e.message); }
}
