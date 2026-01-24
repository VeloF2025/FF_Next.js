/**
 * Explore Odoo Invoices (account.move)
 */

class OdooClient {
  constructor(config) {
    this.url = config.url;
    this.db = config.db;
    this.username = config.username;
    this.password = config.password;
    this.uid = null;
  }

  async authenticate() {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'common', method: 'authenticate', args: [this.db, this.username, this.password, {}] },
        id: 1
      })
    });
    const data = await response.json();
    this.uid = data.result;
    if (!this.uid) throw new Error('Authentication failed');
    return this.uid;
  }

  async call(model, method, args, kwargs = {}) {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'object', method: 'execute_kw', args: [this.db, this.uid, this.password, model, method, args, kwargs] },
        id: Date.now()
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    return data.result;
  }
}

async function explore() {
  const client = new OdooClient({
    url: 'https://velocityfibre.odoo.com',
    db: 'velocityfibre',
    username: 'jacques@velocityfibre.co.za',
    password: 'Ledene9685@'
  });

  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  // Get account.move (invoices) by type
  console.log('=== Exploring account.move (Invoices) ===');

  const types = await client.call('account.move', 'read_group', [
    [['state', '!=', 'cancel']]
  ], {
    fields: ['move_type'],
    groupby: ['move_type']
  });
  console.log('Invoice types:');
  types.forEach(t => console.log('  ' + t.move_type + ': ' + t.move_type_count));

  // Get sample vendor bill
  console.log('\n=== Sample Vendor Bills ===');
  const bills = await client.call('account.move', 'search_read', [
    [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']]
  ], {
    fields: ['name', 'partner_id', 'invoice_date', 'amount_total', 'amount_untaxed', 'amount_tax',
             'state', 'payment_state', 'ref', 'invoice_origin', 'currency_id'],
    limit: 5
  });
  bills.forEach(b => {
    console.log('  ' + b.name + ' | ' + (b.partner_id ? b.partner_id[1] : 'No vendor') + ' | R' + b.amount_total + ' | ' + b.payment_state);
  });

  // Count vendor bills
  const billCount = await client.call('account.move', 'search_count', [
    [['move_type', '=', 'in_invoice']]
  ]);
  console.log('\nTotal Vendor Bills:', billCount);

  // Count by state
  const states = await client.call('account.move', 'read_group', [
    [['move_type', '=', 'in_invoice']]
  ], {
    fields: ['state'],
    groupby: ['state']
  });
  console.log('By state:');
  states.forEach(s => console.log('  ' + s.state + ': ' + s.state_count));

  // Check payment states
  const payStates = await client.call('account.move', 'read_group', [
    [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']]
  ], {
    fields: ['payment_state'],
    groupby: ['payment_state']
  });
  console.log('\nPayment states (posted bills):');
  payStates.forEach(p => console.log('  ' + p.payment_state + ': ' + p.payment_state_count));

  // Get top vendors by invoice amount
  console.log('\n=== Top Vendors by Invoice Amount ===');
  const vendorTotals = await client.call('account.move', 'read_group', [
    [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']]
  ], {
    fields: ['partner_id', 'amount_total:sum'],
    groupby: ['partner_id'],
    orderby: 'amount_total desc',
    limit: 10
  });
  vendorTotals.forEach(v => {
    if (v.partner_id) {
      console.log('  R ' + Number(v.amount_total).toLocaleString().padStart(12) + ' | ' + v.partner_id[1]);
    }
  });
}

explore().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
