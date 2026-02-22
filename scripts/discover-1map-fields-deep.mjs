// Deep 1Map field discovery - fetch more records to see all status values
const BASE_URL = 'https://www.1map.co.za';
const EMAIL = 'hein@velocityfibre.co.za';
const PASSWORD = 'VeloF@2025';

async function authenticate() {
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

  await fetch(BASE_URL + '/app?layer=5121', {
    headers: { 'Cookie': authCookies.join('; ') },
    signal: AbortSignal.timeout(30000),
  });

  return authCookies.join('; ');
}

async function search(cookieStr, query, page = 1, limit = 500) {
  const formData = new URLSearchParams({
    ungeocoded: 'false', left: '0', bottom: '0', right: '0', top: '0',
    selfilter: '', action: 'get', email: EMAIL, layerid: '5121',
    sort: 'prop_id', templateExpression: '', q: query,
    page: String(page), start: String((page - 1) * limit), limit: String(limit),
  });

  const res = await fetch(BASE_URL + '/api/apps/app/getattributes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': cookieStr,
    },
    body: formData.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });

  return await res.json();
}

async function discover() {
  console.log('Authenticating...');
  const cookies = await authenticate();
  console.log('Authenticated OK');

  // Fetch 3 pages of MAM to get good status variety
  const statusCounts = {};
  const stageFieldSamples = {};
  let totalRecords = 0;

  for (let page = 1; page <= 3; page++) {
    console.log(`Fetching page ${page}...`);
    const data = await search(cookies, 'MAM', page, 500);
    if (!data.result || data.result.length === 0) break;

    totalRecords += data.result.length;
    console.log(`  Got ${data.result.length} records (total: ${totalRecords}, pages: ${data.total_pages})`);

    for (const record of data.result) {
      // Count statuses
      const s = record.status || '(empty)';
      statusCounts[s] = (statusCounts[s] || 0) + 1;

      // Collect stage-related field samples
      const stageFields = [
        'install', 'status', 'status_dc', 'status_mn', 'flowname',
        'last_modified_poles_by', 'last_modified_poles_date',
        'last_modified_signup_by', 'last_modified_signup_date',
        'last_modified_install_by', 'last_modified_install_date',
        'last_modified_awareness_by', 'last_modified_awareness_date',
        'last_modified_sales_by', 'last_modified_sales_date',
        'date_status_changed', 'surv_date',
        'poleconc', 'pole', 'pons', 'sect', 'site',
        'cons_pp', 'cons_hi',
      ];

      for (const f of stageFields) {
        const val = record[f];
        if (val !== null && val !== '' && val !== undefined) {
          if (!stageFieldSamples[f]) stageFieldSamples[f] = new Set();
          if (stageFieldSamples[f].size < 20) {
            stageFieldSamples[f].add(typeof val === 'string' ? val : JSON.stringify(val));
          }
        }
      }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Print status distribution
  console.log('\n=== STATUS DISTRIBUTION (' + totalRecords + ' records) ===');
  const sorted = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  for (const [status, count] of sorted) {
    const pct = ((count / totalRecords) * 100).toFixed(1);
    console.log(`  ${status}: ${count} (${pct}%)`);
  }

  // Print stage field samples
  console.log('\n=== STAGE FIELD SAMPLES ===');
  for (const [field, values] of Object.entries(stageFieldSamples)) {
    const arr = [...values];
    console.log(`  ${field}: ${JSON.stringify(arr.slice(0, 10))}`);
  }

  // Print site distribution
  console.log('\n=== SITE CODES FOUND ===');
  // We searched for MAM but may get other sites
  const sites = {};
  // Not tracked separately, but we can infer from pole labels
}

discover().catch(err => console.error('ERROR:', err.message));
