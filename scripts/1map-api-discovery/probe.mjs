#!/usr/bin/env node
/**
 * 1Map API Probe Script
 * Discovers the update endpoint format for field modifications
 */

const TOKEN = "faac7ae2-6e22-40c7-95c2-03649ece63d1";
const LAYER_ID = 5121;
const DR = "DR1738319";
const PROP_ID = 439108;

async function probe() {
  console.log("=== 1Map API Probe ===\n");

  // 1. Test READ endpoint (we know this works)
  console.log("1. Testing READ endpoint...");
  try {
    const readUrl = `https://www.1map.co.za/api/v1/data/${LAYER_ID}?CQL_FILTER=drp='${DR}'&token=${TOKEN}`;
    const readRes = await fetch(readUrl);
    const readData = await readRes.json();
    console.log(`   Status: ${readRes.status}`);
    console.log(`   Records: ${readData.features ? readData.features.length : 0}`);
    if (readData.features && readData.features[0] && readData.features[0].properties) {
      const props = readData.features[0].properties;
      console.log(`   ONT (ph_ont): ${props.ph_ont || 'N/A'}`);
      console.log(`   UPS (br_ser): ${props.br_ser || 'N/A'}`);
      console.log(`   prop_id: ${props.prop_id || 'N/A'}`);
      console.log(`   fid: ${readData.features[0].id || 'N/A'}`);
    }
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }

  // 2. Check if there's an API schema/docs endpoint
  console.log("\n2. Probing for API documentation...");
  const docEndpoints = [
    '/api/v1',
    '/api/v1/docs',
    '/api/v1/swagger',
    '/api/v1/openapi',
    '/api/docs',
  ];
  for (const ep of docEndpoints) {
    try {
      const res = await fetch(`https://www.1map.co.za${ep}?token=${TOKEN}`);
      console.log(`   ${ep}: ${res.status}`);
    } catch (e) {
      console.log(`   ${ep}: Error`);
    }
  }

  // 3. Probe potential UPDATE endpoints (OPTIONS request first - safe)
  console.log("\n3. Probing UPDATE endpoints (OPTIONS only - safe)...");
  const updateEndpoints = [
    `/api/v1/data/${LAYER_ID}/${PROP_ID}`,
    `/api/v1/data/${LAYER_ID}/features/${PROP_ID}`,
    `/api/v1/layers/${LAYER_ID}/features/${PROP_ID}`,
    `/api/v1/feature/${LAYER_ID}/${PROP_ID}`,
    `/api/v1/update/${LAYER_ID}/${PROP_ID}`,
  ];

  for (const ep of updateEndpoints) {
    try {
      const res = await fetch(`https://www.1map.co.za${ep}?token=${TOKEN}`, {
        method: 'OPTIONS'
      });
      const allowHeader = res.headers.get('allow') || res.headers.get('Access-Control-Allow-Methods') || 'N/A';
      console.log(`   ${ep}`);
      console.log(`      Status: ${res.status}, Allow: ${allowHeader}`);
    } catch (e) {
      console.log(`   ${ep}: Error - ${e.message}`);
    }
  }

  // 4. Try a GET on the prop_id endpoint to see structure
  console.log("\n4. Testing GET on property endpoints...");
  for (const ep of updateEndpoints.slice(0, 3)) {
    try {
      const res = await fetch(`https://www.1map.co.za${ep}?token=${TOKEN}`);
      const text = await res.text();
      console.log(`   GET ${ep}: ${res.status}`);
      if (res.status === 200 && text.length < 500) {
        console.log(`      Response: ${text.substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`   ${ep}: Error`);
    }
  }

  // 5. Try POST to the data endpoint to see what it expects
  console.log("\n5. Testing POST endpoints (empty body to see error response)...");
  const postEndpoints = [
    `/api/v1/data/${LAYER_ID}`,
    `/api/v1/data/${LAYER_ID}/update`,
    `/api/v1/layers/${LAYER_ID}/features`,
  ];

  for (const ep of postEndpoints) {
    try {
      const res = await fetch(`https://www.1map.co.za${ep}?token=${TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const text = await res.text();
      console.log(`   POST ${ep}: ${res.status}`);
      console.log(`      Response: ${text.substring(0, 300)}`);
    } catch (e) {
      console.log(`   ${ep}: Error - ${e.message}`);
    }
  }

  console.log("\n=== Probe Complete ===");
}

probe();
