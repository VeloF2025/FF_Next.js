// scripts/vlm-bench/seedSha.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const dir = path.join(__dirname, 'datasets/golden/serials');
const manifestPath = path.join(dir, 'cases.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Array<{ imageRef: string; sha256: string }>;
for (const c of manifest) {
  const buf = fs.readFileSync(path.join(dir, c.imageRef));
  c.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write('sha256 filled\n');
