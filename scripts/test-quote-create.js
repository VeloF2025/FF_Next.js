const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async () => {
  const extractionId = '8b51d575-5f67-4a30-b9cc-cc5ad55568a4';
  
  // Get extraction
  const extractions = await sql`SELECT * FROM quote_extractions WHERE id = ${extractionId}`;
  if (extractions.length === 0) { console.log('No extraction'); return; }
  const ext = extractions[0];
  console.log('Extraction found:', ext.extracted_supplier_name);
  
  // Try to find supplier
  let supplierId = null;
  const searchName = '%' + ext.extracted_supplier_name + '%';
  const suppliers = await sql`
    SELECT id FROM suppliers 
    WHERE LOWER(company_name) LIKE LOWER(${searchName})
    LIMIT 1
  `;
  
  if (suppliers.length > 0) {
    supplierId = suppliers[0].id;
    console.log('Found existing supplier:', supplierId);
  } else {
    const newSupplier = await sql`
      INSERT INTO suppliers (name, company_name, status)
      VALUES (${ext.extracted_supplier_name}, ${ext.extracted_supplier_name}, 'active')
      RETURNING id
    `;
    supplierId = newSupplier[0].id;
    console.log('Created new supplier:', supplierId);
  }
  
  // Create quote
  try {
    const quoteNum = ext.extracted_quote_number || 'SCAN-' + Date.now();
    const total = ext.extracted_total || 0;
    
    const quote = await sql`
      INSERT INTO quotes (
        rfq_id, supplier_id, project_id, quote_number, quote_reference,
        status, submission_date, valid_until, total_value, subtotal, currency, notes
      ) VALUES (
        ${ext.rfq_id}, ${supplierId}, ${ext.project_id},
        ${quoteNum}, ${ext.extracted_quote_number},
        'received', NOW(), NOW() + INTERVAL '30 days',
        ${total}, ${total}, 'ZAR', 'Created from scanned document'
      )
      RETURNING id, quote_number
    `;
    console.log('Quote created:', quote[0]);
    
    // Update extraction status
    await sql`UPDATE quote_extractions SET status = 'applied' WHERE id = ${extractionId}`;
    console.log('Extraction marked as applied');
  } catch (err) {
    console.log('Error creating quote:', err.message);
  }
})();
