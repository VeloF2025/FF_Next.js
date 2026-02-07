#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');
const { v4: uuidv4 } = require('uuid');

// Database connection
const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

// Utility functions (same as before)
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max, decimals = 2) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
const randomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomElements = (arr, count) => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

const generateCIPCNumber = () => `${randomInt(2015, 2023)}/${randomInt(100000, 999999)}/07`;
const generateVATNumber = () => `4${randomInt(100000000, 999999999)}`;

// Data arrays (same as before)
const contractorCompanyNames = [
  'Khula Construction Group', 'Ubuntu Fiber Solutions', 'Amandla Infrastructure',
  'Sisonke Networks', 'Thutuka Engineering', 'Vukani Telecommunications',
  'Phambili Construction', 'Masakhane Fiber', 'Imbokodo Civil Works',
  'Sizani Construction', 'Inkanyezi Infrastructure', 'Qhawe Network Solutions',
  'Isibani Fiber Optics', 'Umthombo Civils', 'Vela Construction',
  'Khanyisa Networks', 'Ithemba Engineering', 'Siyaya Contractors',
  'Nkosi Infrastructure', 'Zenzele Construction', 'Masikhule Fiber Tech'
];

const cities = ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth'];
const specializations = ['Fiber Installation', 'Civil Works', 'Pole Installation', 'Drop Installation'];
const teamTypes = ['Installation', 'Maintenance', 'Emergency', 'Survey'];
const saFirstNames = ['Thabo', 'Sipho', 'Bongani', 'Mandla', 'Peter', 'John', 'Sarah', 'Linda'];
const saLastNames = ['Nkosi', 'Dlamini', 'Ndlovu', 'Zulu', 'Van Der Merwe', 'Smith'];
const bankNames = ['FNB', 'Standard Bank', 'ABSA', 'Nedbank'];

function getProvinceForCity(city) {
  const map = {
    'Johannesburg': 'Gauteng', 'Pretoria': 'Gauteng',
    'Cape Town': 'Western Cape', 'Durban': 'KwaZulu-Natal',
    'Port Elizabeth': 'Eastern Cape'
  };
  return map[city] || 'Gauteng';
}

// Batch insert function
async function batchInsert(tableName, data, batchSize = 50) {
  if (!data || data.length === 0) return;
  
  console.log(`💾 Inserting ${data.length} records into ${tableName}...`);
  
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    
    // Build dynamic query based on first record's keys
    const columns = Object.keys(batch[0]);
    const placeholders = batch.map((_, idx) => 
      `(${columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(', ')})`
    ).join(', ');
    
    const values = batch.flatMap(row => 
      columns.map(col => row[col])
    );
    
    const query = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES ${placeholders}
      ON CONFLICT DO NOTHING
    `;
    
    try {
      await sql(query, values);
      process.stdout.write(`\r  Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(data.length / batchSize)} completed`);
    } catch (error) {
      console.error(`\n❌ Error in batch ${Math.floor(i / batchSize) + 1}:`, error.message);
    }
  }
  console.log(`\n✅ Inserted ${data.length} records into ${tableName}`);
}

// Generate all data
async function generateAllData() {
  const contractors = [];
  const teams = [];
  const members = [];
  const assignments = [];
  const ragScores = [];
  
  // Generate contractors
  for (let i = 0; i < 25; i++) {
    const city = randomElement(cities);
    const contractor = {
      id: uuidv4(),
      company_name: contractorCompanyNames[i] || `Contractor ${i + 1}`,
      registration_number: generateCIPCNumber(),
      contact_person: `${randomElement(saFirstNames)} ${randomElement(saLastNames)}`,
      email: `info@contractor${i + 1}.co.za`,
      phone: `0${randomInt(11, 87)}${randomInt(1000000, 9999999)}`,
      city,
      province: getProvinceForCity(city),
      postal_code: randomInt(1000, 9999).toString(),
      vat_number: generateVATNumber(),
      bee_level: randomInt(1, 8),
      bee_expiry_date: new Date(Date.now() + randomInt(30, 365) * 24 * 60 * 60 * 1000).toISOString(),
      number_of_employees: randomInt(10, 100),
      bank_name: randomElement(bankNames),
      bank_account_number: randomInt(1000000000, 9999999999).toString(),
      insurance_expiry_date: new Date(Date.now() + randomInt(30, 365) * 24 * 60 * 60 * 1000).toISOString(),
      safety_rating: randomFloat(70, 95),
      quality_score: randomFloat(75, 98),
      on_time_delivery: randomFloat(80, 99),
      rag_overall: randomElement(['Green', 'Green', 'Amber']),
      status: 'Active',
      capabilities: JSON.stringify(randomElements(specializations, 3)),
      certifications: JSON.stringify(['CIDB', 'ISO 9001']),
      credit_limit: randomInt(100000, 2000000)
    };
    contractors.push(contractor);
    
    // Generate teams for this contractor
    const teamCount = randomInt(2, 3);
    for (let t = 0; t < teamCount; t++) {
      const teamId = uuidv4();
      const team = {
        id: teamId,
        contractor_id: contractor.id,
        team_name: `${contractor.company_name.split(' ')[0]} Team ${t + 1}`,
        team_type: randomElement(teamTypes),
        specialization: randomElement(specializations),
        max_capacity: randomInt(5, 12),
        current_capacity: randomInt(3, 10),
        status: 'Active',
        performance_score: randomFloat(70, 95)
      };
      teams.push(team);
      
      // Generate members for this team
      const memberCount = randomInt(5, 8);
      for (let m = 0; m < memberCount; m++) {
        const member = {
          id: uuidv4(),
          team_id: teamId,
          contractor_id: contractor.id,
          first_name: randomElement(saFirstNames),
          last_name: randomElement(saLastNames),
          id_number: `${randomInt(70, 99)}${randomInt(10, 12).toString().padStart(2, '0')}${randomInt(10, 28).toString().padStart(2, '0')}${randomInt(1000, 9999)}08${randomInt(0, 9)}`,
          email: `member${randomInt(1000, 9999)}@contractor.co.za`,
          phone: `0${randomInt(60, 84)}${randomInt(1000000, 9999999)}`,
          role: m === 0 ? 'Team Leader' : randomElement(['Technician', 'Assistant']),
          years_experience: randomInt(1, 10),
          status: 'Active',
          performance_rating: randomFloat(70, 95),
          safety_score: randomFloat(75, 100)
        };
        members.push(member);
      }
    }
    
    // Generate project assignments
    for (let a = 0; a < randomInt(2, 5); a++) {
      const assignment = {
        id: uuidv4(),
        project_id: `PROJ-2025-${(a + 1).toString().padStart(3, '0')}`,
        contractor_id: contractor.id,
        team_id: teams.find(t => t.contractor_id === contractor.id)?.id,
        assignment_type: randomElement(['Primary', 'Secondary']),
        scope: 'Fiber installation and testing',
        start_date: new Date(Date.now() - randomInt(0, 180) * 24 * 60 * 60 * 1000).toISOString(),
        end_date: new Date(Date.now() + randomInt(30, 365) * 24 * 60 * 60 * 1000).toISOString(),
        status: randomElement(['Active', 'In Progress']),
        progress_percentage: randomInt(10, 90)
      };
      assignments.push(assignment);
    }
    
    // Generate RAG scores
    for (let r = 0; r < 6; r++) {
      const date = new Date();
      date.setMonth(date.getMonth() - r);
      
      const perf = randomFloat(70, 95);
      const qual = randomFloat(75, 98);
      const safe = randomFloat(80, 100);
      const comp = randomFloat(85, 100);
      const fin = randomFloat(70, 95);
      const overall = (perf * 0.3 + qual * 0.25 + safe * 0.25 + comp * 0.1 + fin * 0.1);
      
      const score = {
        id: uuidv4(),
        contractor_id: contractor.id,
        assessment_date: date.toISOString(),
        performance_score: perf,
        quality_score: qual,
        safety_score: safe,
        compliance_score: comp,
        financial_score: fin,
        overall_score: parseFloat(overall.toFixed(2)),
        rag_status: overall >= 80 ? 'Green' : overall >= 65 ? 'Amber' : 'Red',
        assessed_by: 'System'
      };
      ragScores.push(score);
    }
  }
  
  return { contractors, teams, members, assignments, ragScores };
}

// Main execution
async function main() {
  console.log('🚀 Starting optimized contractor data population...\n');
  
  try {
    // Generate all data
    console.log('📊 Generating all data...');
    const { contractors, teams, members, assignments, ragScores } = await generateAllData();
    
    console.log(`\nGenerated:
      - ${contractors.length} contractors
      - ${teams.length} teams
      - ${members.length} members
      - ${assignments.length} assignments
      - ${ragScores.length} RAG scores\n`);
    
    // Batch insert all data
    await batchInsert('contractors', contractors);
    await batchInsert('contractor_teams', teams);
    await batchInsert('team_members', members);
    await batchInsert('project_assignments', assignments);
    await batchInsert('contractor_rag_scores', ragScores);
    
    // Verify insertion
    console.log('\n📊 Verifying data...\n');
    
    const counts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM contractors) as contractors,
        (SELECT COUNT(*) FROM contractor_teams) as teams,
        (SELECT COUNT(*) FROM team_members) as members,
        (SELECT COUNT(*) FROM project_assignments) as assignments,
        (SELECT COUNT(*) FROM contractor_rag_scores) as rag_scores
    `;
    
    console.log('Database counts:');
    console.log(`  - Contractors: ${counts[0].contractors}`);
    console.log(`  - Teams: ${counts[0].teams}`);
    console.log(`  - Members: ${counts[0].members}`);
    console.log(`  - Assignments: ${counts[0].assignments}`);
    console.log(`  - RAG Scores: ${counts[0].rag_scores}`);
    
    // Show sample contractor data
    console.log('\n📋 Sample contractors:');
    const samples = await sql`
      SELECT company_name, registration_number, bee_level, safety_rating, rag_overall
      FROM contractors
      ORDER BY created_at DESC
      LIMIT 5
    `;
    console.table(samples);
    
    console.log('\n✅ Data population completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);