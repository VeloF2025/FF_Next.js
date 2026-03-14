import { OneMapClient } from './src/services/onemap/oneMapClient';

const client = new OneMapClient({
  email: process.env.ONEMAP_EMAIL || 'hein@velocityfibre.co.za',
  password: process.env.ONEMAP_PASSWORD || 'VeloF@2025',
});

async function main() {
  const authed = await client.authenticate();
  console.log('Auth:', authed);
  if (!authed) process.exit(1);

  const testDrops = ['DR1861759','DR475729','DR1733225','DR1736888','DR1859804'];

  for (const dr of testDrops) {
    try {
      const result = await client.getDR(dr);
      if (result) {
        const r = result as any;
        console.log(`\n${dr}: FOUND`);
        console.log('  Keys:', Object.keys(r).slice(0,15).join(', '));
        const statusKeys = Object.keys(r).filter(k => /status|stage|activat|photo|complete/i.test(k));
        statusKeys.forEach(k => console.log(`  ${k}: ${r[k]}`));
      } else {
        console.log(`\n${dr}: NOT FOUND`);
      }
    } catch(e: any) {
      console.log(`${dr}: ERROR - ${e.message}`);
    }
  }
}
main().catch(console.error);
