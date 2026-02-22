// Standalone 1Map field discovery - no TS path aliases
const BASE_URL = 'https://www.1map.co.za';
const EMAIL = 'hein@velocityfibre.co.za';
const PASSWORD = 'VeloF@2025';

async function discover() {
  // Step 1: Get CSRF token
  console.log('Step 1: Getting CSRF token...');
  const loginPage = await fetch(BASE_URL + '/login', { signal: AbortSignal.timeout(30000) });
  const html = await loginPage.text();
  const csrfMatch = html.match(/name="_csrf".*?value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  const pageCookies = loginPage.headers.get('set-cookie') || '';
  const sidMatch = pageCookies.match(/connect\.sid=([^;]+)/);
  const csrfCookie = pageCookies.match(/csrfToken=([^;]+)/);

  const cookies = [];
  if (sidMatch) cookies.push('connect.sid=' + sidMatch[1]);
  if (csrfCookie) cookies.push('csrfToken=' + csrfCookie[1]);

  // Step 2: Login
  console.log('Step 2: Logging in...');
  const loginRes = await fetch(BASE_URL + '/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies.join('; '),
    },
    body: new URLSearchParams({ _csrf: csrf, email: EMAIL, password: PASSWORD }).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });

  const setCookie = loginRes.headers.get('set-cookie') || '';
  const newSid = setCookie.match(/connect\.sid=([^;]+)/);
  const newCsrf = setCookie.match(/csrfToken=([^;]+)/);

  const authCookies = [];
  if (newSid) authCookies.push('connect.sid=' + newSid[1]);
  if (newCsrf) authCookies.push('csrfToken=' + newCsrf[1]);

  console.log('Login status:', loginRes.status);

  // Step 3: Init layer
  console.log('Step 3: Initializing layer...');
  await fetch(BASE_URL + '/app?layer=5121', {
    headers: { 'Cookie': authCookies.join('; ') },
    signal: AbortSignal.timeout(30000),
  });

  // Step 4: Fetch MAM records (1 page, 10 records)
  console.log('Step 4: Fetching MAM records...');
  const formData = new URLSearchParams({
    ungeocoded: 'false', left: '0', bottom: '0', right: '0', top: '0',
    selfilter: '', action: 'get', email: EMAIL, layerid: '5121',
    sort: 'prop_id', templateExpression: '', q: 'MAM',
    page: '1', start: '0', limit: '10',
  });

  const searchRes = await fetch(BASE_URL + '/api/apps/app/getattributes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': authCookies.join('; '),
    },
    body: formData.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });

  const data = await searchRes.json();

  if (data.success === false || !data.result || data.result.length === 0) {
    console.log('No results. Response:', JSON.stringify(data).substring(0, 500));
    return;
  }

  console.log('\n=== RECORDS FETCHED:', data.result.length, '===');
  console.log('Total pages:', data.total_pages);

  // Collect all field names
  const fieldSet = new Set();
  for (const record of data.result) {
    for (const key of Object.keys(record)) {
      fieldSet.add(key);
    }
  }

  const fields = Array.from(fieldSet).sort();
  console.log('\n=== ALL FIELDS (' + fields.length + ') ===');
  console.log(fields.join('\n'));

  // Show first record with non-null values
  console.log('\n=== SAMPLE RECORD (non-null fields) ===');
  const sample = data.result[0];
  for (const [key, value] of Object.entries(sample)) {
    if (value !== null && value !== '' && value !== undefined) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  // Look specifically for stage-related fields
  console.log('\n=== STAGE-RELATED FIELDS (with sample values) ===');
  const stageKeywords = ['permission', 'pole', 'civil', 'cwc', 'sign', 'signup',
    'atp', 'install', 'activation', 'status', 'date', 'dte', 'planted',
    'string', 'splice', 'optical', 'fibre', 'fiber', 'built', 'complete'];
  for (const field of fields) {
    const lower = field.toLowerCase();
    if (stageKeywords.some(kw => lower.includes(kw))) {
      // Show unique values from all records for this field
      const values = data.result
        .map(r => r[field])
        .filter(v => v !== null && v !== '' && v !== undefined);
      const unique = [...new Set(values)];
      if (unique.length > 0) {
        console.log(`  ${field}: ${JSON.stringify(unique)}`);
      } else {
        console.log(`  ${field}: (all null/empty)`);
      }
    }
  }

  // Show all unique status values
  console.log('\n=== ALL UNIQUE STATUS VALUES ===');
  const statuses = data.result.map(r => r.status).filter(Boolean);
  const uniqueStatuses = [...new Set(statuses)];
  for (const s of uniqueStatuses) {
    console.log(`  "${s}"`);
  }
}

discover().catch(err => console.error('ERROR:', err.message));
