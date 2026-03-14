import { OneMapClient } from './src/services/onemap/oneMapClient';

const client = new OneMapClient({
  email: 'hein@velocityfibre.co.za',
  password: 'VeloF@2025',
});

const missing98 = [
  // Lawley
  "DR1733225","DR1736916","DR1729956","DR1736900","DR1729957","DR1736919","DR1736051",
  "DR1736876","DR1736924","DR1736931","DR1736873","DR7744487","DR1736737","DR1736904",
  "DR1733226","DR1745888","DR1753186","DR1745070",
  // Mamelodi
  "DR475729","DR475749","DR475684","DR475774","DR473341","DR473347","DR473344",
  "DR473338","DR474213","DR475682","DR475721","DR473342","DR475688","DR472786",
  "DR472782","DR472785","DR472783","DR472784","DR475741","DR469965","DR469970",
  "DR473329","DR472771","DR471131","DR471126","DR474131",
  // Marketing
  "DR1736888","DR1736895","DR1736917",
  // Mohadin
  "DR1861759","DR1861756","DR1861758","DR1861803","DR1861753","DR1861770","DR1861763",
  "DR1864342","DR1863375","DR1864341","DR1861762","DR1861766","DR1861737","DR1861733",
  "DR1861802","DR1861736","DR1861790","DR1863661","DR1863658","DR1861739","DR1863665",
  "DR1861804","DR1861800","DR1862371","DR1861797","DR1862369","DR1862372","DR1861747",
  "DR1861810","DR1862373","DR1862370","DR1861999","DR1861741","DR1861746","DR1862374",
  "DR1861735","DR1861997","DR1862382","DR1861749","DR1861793","DR1862383","DR1862408",
  "DR1861771","DR1861779","DR1861786","DR1872443","DR1869743","DR1859944","DR1859818",
  "DR1859831","DR1859804"
];

async function main() {
  const authed = await client.authenticate();
  if (!authed) { console.error('Auth failed'); process.exit(1); }

  const results: Record<string, any> = {};

  for (const dr of missing98) {
    try {
      const r = await client.getDR(dr) as any;
      if (r) {
        results[dr] = {
          status: r.status || '',
          status_dc: r.status_dc || '',
          photo_new_ont: r.photo_new_ont || null,
          date_changed: r.date_status_changed || '',
        };
      } else {
        results[dr] = { status: 'NOT FOUND', status_dc: '', photo_new_ont: null, date_changed: '' };
      }
    } catch(e: any) {
      results[dr] = { status: 'ERROR', status_dc: '', photo_new_ont: null, date_changed: '' };
    }
  }

  // Summarise
  const groups: Record<string, string[]> = {};
  for (const [dr, info] of Object.entries(results)) {
    const key = `${info.status} | dc:${info.status_dc || 'none'} | ont:${info.photo_new_ont ? 'yes' : 'null'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(dr);
  }

  console.log('\n=== STATUS BREAKDOWN ===');
  for (const [key, drops] of Object.entries(groups).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`\n[${drops.length}] ${key}`);
    drops.forEach(d => console.log(`  ${d}`));
  }
}
main().catch(console.error);
