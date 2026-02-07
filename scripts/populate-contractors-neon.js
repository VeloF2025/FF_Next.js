#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');
const { v4: uuidv4 } = require('uuid');

// Database connection
const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

// Utility functions
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max, decimals = 2) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
const randomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomElements = (arr, count) => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

const generateCIPCNumber = () => {
  const year = randomInt(2015, 2023);
  const number = randomInt(100000, 999999);
  return `${year}/${number}/07`;
};

const generateVATNumber = () => {
  return `4${randomInt(100000000, 999999999)}`;
};

const generateBBBEELevel = () => {
  // Weighted distribution toward levels 4-6
  const weights = [5, 10, 15, 25, 25, 10, 5, 5]; // Level 1-8
  const total = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  
  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return i + 1;
  }
  return 4;
};

// South African contractor company names
const contractorCompanyNames = [
  'Khula Construction Group',
  'Ubuntu Fiber Solutions',
  'Amandla Infrastructure Services',
  'Sisonke Network Contractors',
  'Thutuka Engineering Works',
  'Vukani Telecommunications',
  'Phambili Construction Co',
  'Masakhane Fiber Networks',
  'Imbokodo Civil Works',
  'Sizani Construction Services',
  'Inkanyezi Infrastructure',
  'Qhawe Network Solutions',
  'Isibani Fiber Optics',
  'Umthombo Civils',
  'Vela Construction Group',
  'Khanyisa Networks',
  'Ithemba Engineering',
  'Siyaya Contractors',
  'Nkosi Infrastructure',
  'Zenzele Construction',
  'Masikhule Fiber Tech',
  'Sakha Network Services',
  'Phakama Civil Works',
  'Izwi Communications',
  'Kusile Construction Group',
  'Sinethemba Engineering',
  'Vusani Fiber Solutions',
  'Ilanga Infrastructure',
  'Mthande Construction Co'
];

const cities = [
  'Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth',
  'East London', 'Bloemfontein', 'Pietermaritzburg', 'Polokwane', 'Nelspruit'
];

const specializations = [
  'Fiber Installation', 'Civil Works', 'Pole Installation', 
  'Drop Installation', 'Trenching', 'Cable Pulling', 
  'Splicing', 'Testing & Commissioning', 'Maintenance'
];

const teamTypes = ['Installation', 'Maintenance', 'Emergency', 'Survey', 'Quality Control'];

const saFirstNames = [
  'Thabo', 'Sipho', 'Bongani', 'Mandla', 'Themba', 'Sibusiso', 'Nkosi', 'Dumisani',
  'Sandile', 'Musa', 'Lungile', 'Sello', 'Kagiso', 'Tebogo', 'Lerato', 'Nomsa',
  'Ntombi', 'Palesa', 'Zodwa', 'Busisiwe', 'Peter', 'John', 'David', 'Michael',
  'James', 'Sarah', 'Linda', 'Mary', 'Susan', 'Jessica', 'Mohammed', 'Ahmed',
  'Fatima', 'Ayesha', 'Ravi', 'Priya', 'Arun', 'Anita', 'Johan', 'Pieter'
];

const saLastNames = [
  'Nkosi', 'Dlamini', 'Ndlovu', 'Zulu', 'Sithole', 'Mkhize', 'Khumalo', 'Ngcobo',
  'Mthembu', 'Naidoo', 'Pillay', 'Govind', 'Reddy', 'Khan', 'Patel', 'Van Der Merwe',
  'Botha', 'Pretorius', 'Kruger', 'Jacobs', 'Williams', 'Smith', 'Jones', 'Brown',
  'Mokoena', 'Mahlangu', 'Molefe', 'Modise', 'Motaung', 'Radebe', 'Tshabalala'
];

const streetNames = [
  'Main', 'Church', 'Market', 'Pretoria', 'Voortrekker', 'Mandela', 'Beyers Naude',
  'Commissioner', 'Jan Smuts', 'Oxford', 'Long', 'Loop', 'Bree', 'Strand', 'Victoria'
];

const bankNames = ['FNB', 'Standard Bank', 'ABSA', 'Nedbank', 'Capitec'];
const insuranceProviders = ['Santam', 'Old Mutual', 'Discovery', 'Hollard', 'OUTsurance'];

function getProvinceForCity(city) {
  const provinceMap = {
    'Johannesburg': 'Gauteng',
    'Pretoria': 'Gauteng',
    'Cape Town': 'Western Cape',
    'Durban': 'KwaZulu-Natal',
    'Pietermaritzburg': 'KwaZulu-Natal',
    'Port Elizabeth': 'Eastern Cape',
    'East London': 'Eastern Cape',
    'Bloemfontein': 'Free State',
    'Polokwane': 'Limpopo',
    'Nelspruit': 'Mpumalanga'
  };
  return provinceMap[city] || 'Gauteng';
}

function generateSAIDNumber() {
  const year = randomInt(70, 99);
  const month = randomInt(1, 12).toString().padStart(2, '0');
  const day = randomInt(1, 28).toString().padStart(2, '0');
  const sequence = randomInt(0, 4999).toString().padStart(4, '0');
  const citizenship = randomElement(['0', '1']);
  const checksum = randomInt(0, 9);
  
  return `${year}${month}${day}${sequence}${citizenship}8${checksum}`;
}

function generateFutureDate(minMonths = 1, maxMonths = 24) {
  const date = new Date();
  date.setMonth(date.getMonth() + randomInt(minMonths, maxMonths));
  return date.toISOString();
}

function generatePastDate(maxYears = 2) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - randomInt(0, maxYears));
  date.setMonth(randomInt(0, 11));
  date.setDate(randomInt(1, 28));
  return date.toISOString();
}

// Main data generation functions
async function generateContractors() {
  const contractors = [];
  
  for (let i = 0; i < contractorCompanyNames.length; i++) {
    const companyName = contractorCompanyNames[i];
    const city = randomElement(cities);
    const companySlug = companyName.toLowerCase().replace(/\s+/g, '');
    
    const contractor = {
      id: uuidv4(),
      company_name: companyName,
      registration_number: generateCIPCNumber(),
      contact_person: `${randomElement(saFirstNames)} ${randomElement(saLastNames)}`,
      email: `info@${companySlug}.co.za`,
      phone: `0${randomInt(11, 87)}${randomInt(1000000, 9999999)}`,
      alternative_phone: Math.random() > 0.5 ? `0${randomInt(11, 87)}${randomInt(1000000, 9999999)}` : null,
      address: `${randomInt(1, 999)} ${randomElement(streetNames)} Street`,
      city,
      province: getProvinceForCity(city),
      postal_code: randomInt(1000, 9999).toString(),
      website: Math.random() > 0.3 ? `https://www.${companySlug}.co.za` : null,
      vat_number: generateVATNumber(),
      bee_level: generateBBBEELevel(),
      bee_expiry_date: generateFutureDate(1, 24),
      number_of_employees: randomInt(10, 200),
      established_date: generatePastDate(15),
      bank_name: randomElement(bankNames),
      bank_account_number: randomInt(1000000000, 9999999999).toString(),
      bank_branch_code: randomInt(100000, 999999).toString(),
      insurance_provider: randomElement(insuranceProviders),
      insurance_policy_number: `POL${randomInt(100000, 999999)}`,
      insurance_expiry_date: generateFutureDate(3, 24),
      safety_rating: randomFloat(65, 98, 1),
      quality_score: randomFloat(70, 95, 1),
      on_time_delivery: randomFloat(75, 98, 1),
      rag_performance: randomElement(['Green', 'Amber', 'Green', 'Green']),
      rag_quality: randomElement(['Green', 'Green', 'Amber', 'Green']),
      rag_safety: randomElement(['Green', 'Green', 'Green', 'Amber']),
      rag_overall: randomElement(['Green', 'Green', 'Amber', 'Green']),
      status: randomElement(['Active', 'Active', 'Active', 'Pending']),
      notes: Math.random() > 0.7 ? 'Reliable contractor with good track record' : null,
      capabilities: JSON.stringify(randomElements(specializations, randomInt(2, 5))),
      certifications: JSON.stringify(['CIDB', 'ISO 9001', 'OHSAS 18001'].filter(() => Math.random() > 0.3)),
      preferred_payment_terms: randomElement(['30 days', '60 days', '45 days']),
      credit_limit: randomInt(100000, 5000000),
      created_by: 'system',
      updated_by: 'system',
      created_at: generatePastDate(2),
      updated_at: new Date().toISOString()
    };
    
    contractors.push(contractor);
  }
  
  return contractors;
}

async function generateTeams(contractors) {
  const teams = [];
  
  for (const contractor of contractors) {
    const teamCount = randomInt(2, 3);
    
    for (let i = 0; i < teamCount; i++) {
      const teamType = randomElement(teamTypes);
      const team = {
        id: uuidv4(),
        contractor_id: contractor.id,
        team_name: `${contractor.company_name.split(' ')[0]} ${teamType} Team ${i + 1}`,
        team_type: teamType,
        specialization: randomElement(specializations),
        max_capacity: randomInt(5, 15),
        current_capacity: randomInt(3, 12),
        leader_id: uuidv4(),
        vehicle_count: randomInt(1, 4),
        equipment_list: JSON.stringify([
          'Fiber splicer', 'OTDR', 'Power meter', 'Cable blower', 'Trenching equipment'
        ].filter(() => Math.random() > 0.3)),
        certifications: JSON.stringify(['Safety Certificate', 'Technical Training'].filter(() => Math.random() > 0.4)),
        status: randomElement(['Active', 'Active', 'Active', 'On Assignment']),
        performance_score: randomFloat(70, 95, 1),
        base_location: `${contractor.city}, ${contractor.province}`,
        operating_radius: randomInt(20, 100),
        created_at: contractor.created_at,
        updated_at: new Date().toISOString()
      };
      
      teams.push(team);
    }
  }
  
  return teams;
}

async function generateTeamMembers(teams, contractors) {
  const members = [];
  const usedIdNumbers = new Set();
  
  for (const team of teams) {
    const contractor = contractors.find(c => c.id === team.contractor_id);
    const memberCount = randomInt(5, 10);
    
    for (let i = 0; i < memberCount; i++) {
      const firstName = randomElement(saFirstNames);
      const lastName = randomElement(saLastNames);
      const isLeader = i === 0;
      
      // Generate unique ID number
      let idNumber;
      do {
        idNumber = generateSAIDNumber();
      } while (usedIdNumbers.has(idNumber));
      usedIdNumbers.add(idNumber);
      
      const companySlug = contractor.company_name.toLowerCase().replace(/\s+/g, '');
      
      const member = {
        id: isLeader ? team.leader_id : uuidv4(),
        team_id: team.id,
        contractor_id: team.contractor_id,
        first_name: firstName,
        last_name: lastName,
        id_number: idNumber,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${companySlug}.co.za`,
        phone: `0${randomInt(60, 84)}${randomInt(1000000, 9999999)}`,
        role: isLeader ? 'Team Leader' : randomElement(['Technician', 'Senior Technician', 'Assistant', 'Driver']),
        skills: JSON.stringify(randomElements([
          'Fiber Splicing', 'Cable Installation', 'Testing', 'Trenching', 
          'Safety Management', 'Quality Control', 'Documentation'
        ], randomInt(2, 4))),
        certifications: JSON.stringify(randomElements([
          'Working at Heights', 'First Aid', 'Fiber Optic Certified', 'Safety Rep'
        ], randomInt(1, 3))),
        years_experience: randomInt(1, 15),
        emergency_contact: `0${randomInt(60, 84)}${randomInt(1000000, 9999999)}`,
        emergency_contact_name: `${randomElement(saFirstNames)} ${lastName}`,
        blood_type: randomElement(['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']),
        medical_conditions: Math.random() > 0.8 ? 'None' : null,
        status: randomElement(['Active', 'Active', 'Active', 'On Leave']),
        performance_rating: randomFloat(65, 95, 1),
        safety_score: randomFloat(70, 100, 1),
        created_at: team.created_at,
        updated_at: new Date().toISOString()
      };
      
      members.push(member);
    }
  }
  
  return members;
}

async function getProjectIds() {
  try {
    const result = await sql`
      SELECT id, project_name 
      FROM projects 
      WHERE status IN ('Active', 'In Progress')
      LIMIT 30
    `;
    return result || [];
  } catch (error) {
    console.log('No existing projects found, will generate sample project IDs');
    return Array.from({ length: 20 }, (_, i) => ({
      id: `PROJ-2025-${(i + 1).toString().padStart(3, '0')}`,
      project_name: `Sample Project ${i + 1}`
    }));
  }
}

async function generateProjectAssignments(contractors, teams, projects) {
  const assignments = [];
  
  for (const project of projects) {
    const assignedContractors = randomElements(contractors, randomInt(2, 4));
    
    for (const contractor of assignedContractors) {
      const contractorTeams = teams.filter(t => t.contractor_id === contractor.id);
      const assignedTeam = randomElement(contractorTeams);
      
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - randomInt(1, 12));
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + randomInt(3, 18));
      
      const assignment = {
        id: uuidv4(),
        project_id: project.id,
        contractor_id: contractor.id,
        team_id: assignedTeam ? assignedTeam.id : null,
        assignment_type: randomElement(['Primary', 'Secondary', 'Support']),
        scope: randomElement([
          'Installation of fiber optic cables for residential areas',
          'Trenching and ducting for main fiber routes',
          'Pole installation and maintenance services',
          'Drop cable installation to customer premises',
          'Fiber splicing and testing services',
          'Network maintenance and fault repairs',
          'Quality assurance and testing',
          'Civil works for fiber infrastructure',
          'Emergency response and repairs'
        ]),
        responsibilities: JSON.stringify([
          'Fiber installation',
          'Quality control',
          'Safety compliance',
          'Progress reporting',
          'Material management'
        ].filter(() => Math.random() > 0.3)),
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        actual_start_date: startDate.toISOString(),
        actual_end_date: Math.random() > 0.5 ? new Date().toISOString() : null,
        status: randomElement(['Active', 'Completed', 'In Progress', 'Active']),
        performance_rating: randomFloat(70, 95, 1),
        quality_score: randomFloat(75, 98, 1),
        safety_score: randomFloat(80, 100, 1),
        progress_percentage: randomInt(10, 100),
        issues_reported: randomInt(0, 5),
        issues_resolved: randomInt(0, 5),
        completion_notes: Math.random() > 0.7 ? 'Work progressing as scheduled' : null,
        created_at: startDate.toISOString(),
        updated_at: new Date().toISOString()
      };
      
      assignments.push(assignment);
    }
  }
  
  return assignments;
}

async function generateRAGScores(contractors) {
  const ragScores = [];
  
  for (const contractor of contractors) {
    for (let month = 0; month < 12; month++) {
      const recordDate = new Date();
      recordDate.setMonth(recordDate.getMonth() - month);
      
      const performanceScore = randomFloat(65, 95, 1);
      const qualityScore = randomFloat(70, 98, 1);
      const safetyScore = randomFloat(75, 100, 1);
      const complianceScore = randomFloat(80, 100, 1);
      const financialScore = randomFloat(70, 95, 1);
      
      const overallScore = (
        performanceScore * 0.3 +
        qualityScore * 0.25 +
        safetyScore * 0.25 +
        complianceScore * 0.1 +
        financialScore * 0.1
      ).toFixed(2);
      
      let ragStatus;
      if (overallScore >= 80) ragStatus = 'Green';
      else if (overallScore >= 65) ragStatus = 'Amber';
      else ragStatus = 'Red';
      
      const score = {
        id: uuidv4(),
        contractor_id: contractor.id,
        assessment_date: recordDate.toISOString(),
        performance_score: performanceScore,
        quality_score: qualityScore,
        safety_score: safetyScore,
        compliance_score: complianceScore,
        financial_score: financialScore,
        overall_score: parseFloat(overallScore),
        rag_status: ragStatus,
        assessment_notes: Math.random() > 0.7 ? 'Performance meeting expectations' : null,
        assessed_by: 'System',
        created_at: recordDate.toISOString()
      };
      
      ragScores.push(score);
    }
  }
  
  return ragScores;
}

// Main execution
async function main() {
  console.log('🚀 Starting contractor data population...\n');
  
  try {
    // Generate data
    console.log('📊 Generating contractor companies...');
    const contractors = await generateContractors();
    console.log(`Generated ${contractors.length} contractors`);
    
    // Insert contractors
    console.log('\n💾 Inserting contractors...');
    for (const contractor of contractors) {
      await sql`
        INSERT INTO contractors (
          id, company_name, registration_number, contact_person, email, phone,
          alternative_phone, address, city, province, postal_code, website,
          vat_number, bee_level, bee_expiry_date, number_of_employees,
          established_date, bank_name, bank_account_number, bank_branch_code,
          insurance_provider, insurance_policy_number, insurance_expiry_date,
          safety_rating, quality_score, on_time_delivery,
          rag_performance, rag_quality, rag_safety, rag_overall,
          status, notes, capabilities, certifications,
          preferred_payment_terms, credit_limit,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${contractor.id}, ${contractor.company_name}, ${contractor.registration_number},
          ${contractor.contact_person}, ${contractor.email}, ${contractor.phone},
          ${contractor.alternative_phone}, ${contractor.address}, ${contractor.city},
          ${contractor.province}, ${contractor.postal_code}, ${contractor.website},
          ${contractor.vat_number}, ${contractor.bee_level}, ${contractor.bee_expiry_date},
          ${contractor.number_of_employees}, ${contractor.established_date},
          ${contractor.bank_name}, ${contractor.bank_account_number}, ${contractor.bank_branch_code},
          ${contractor.insurance_provider}, ${contractor.insurance_policy_number}, ${contractor.insurance_expiry_date},
          ${contractor.safety_rating}, ${contractor.quality_score}, ${contractor.on_time_delivery},
          ${contractor.rag_performance}, ${contractor.rag_quality}, ${contractor.rag_safety}, ${contractor.rag_overall},
          ${contractor.status}, ${contractor.notes}, ${contractor.capabilities}::jsonb, ${contractor.certifications}::jsonb,
          ${contractor.preferred_payment_terms}, ${contractor.credit_limit},
          ${contractor.created_by}, ${contractor.updated_by}, ${contractor.created_at}, ${contractor.updated_at}
        ) ON CONFLICT (registration_number) DO NOTHING
      `;
    }
    console.log(`✅ Inserted ${contractors.length} contractors`);
    
    // Generate and insert teams
    console.log('\n👥 Generating contractor teams...');
    const teams = await generateTeams(contractors);
    console.log(`Generated ${teams.length} teams`);
    
    console.log('💾 Inserting teams...');
    for (const team of teams) {
      await sql`
        INSERT INTO contractor_teams (
          id, contractor_id, team_name, team_type, specialization,
          max_capacity, current_capacity, leader_id, vehicle_count,
          equipment_list, certifications, status, performance_score,
          base_location, operating_radius, created_at, updated_at
        ) VALUES (
          ${team.id}, ${team.contractor_id}, ${team.team_name},
          ${team.team_type}, ${team.specialization}, ${team.max_capacity},
          ${team.current_capacity}, ${team.leader_id}, ${team.vehicle_count},
          ${team.equipment_list}::jsonb, ${team.certifications}::jsonb,
          ${team.status}, ${team.performance_score}, ${team.base_location},
          ${team.operating_radius}, ${team.created_at}, ${team.updated_at}
        ) ON CONFLICT DO NOTHING
      `;
    }
    console.log(`✅ Inserted ${teams.length} teams`);
    
    // Generate and insert team members
    console.log('\n👤 Generating team members...');
    const members = await generateTeamMembers(teams, contractors);
    console.log(`Generated ${members.length} team members`);
    
    console.log('💾 Inserting team members...');
    for (const member of members) {
      await sql`
        INSERT INTO team_members (
          id, team_id, contractor_id, first_name, last_name,
          id_number, email, phone, role, skills, certifications,
          years_experience, emergency_contact, emergency_contact_name,
          blood_type, medical_conditions, status,
          performance_rating, safety_score, created_at, updated_at
        ) VALUES (
          ${member.id}, ${member.team_id}, ${member.contractor_id},
          ${member.first_name}, ${member.last_name}, ${member.id_number},
          ${member.email}, ${member.phone}, ${member.role},
          ${member.skills}::jsonb, ${member.certifications}::jsonb,
          ${member.years_experience}, ${member.emergency_contact},
          ${member.emergency_contact_name}, ${member.blood_type},
          ${member.medical_conditions}, ${member.status},
          ${member.performance_rating}, ${member.safety_score},
          ${member.created_at}, ${member.updated_at}
        ) ON CONFLICT (id_number) DO NOTHING
      `;
    }
    console.log(`✅ Inserted ${members.length} team members`);
    
    // Get projects and generate assignments
    console.log('\n📋 Getting project IDs...');
    const projects = await getProjectIds();
    console.log(`Found ${projects.length} projects`);
    
    if (projects.length > 0) {
      console.log('🔗 Generating project assignments...');
      const assignments = await generateProjectAssignments(contractors, teams, projects);
      console.log(`Generated ${assignments.length} assignments`);
      
      console.log('💾 Inserting project assignments...');
      for (const assignment of assignments) {
        await sql`
          INSERT INTO project_assignments (
            id, project_id, contractor_id, team_id, assignment_type,
            scope, responsibilities, start_date, end_date,
            actual_start_date, actual_end_date, status,
            performance_rating, quality_score, safety_score,
            progress_percentage, issues_reported, issues_resolved,
            completion_notes, created_at, updated_at
          ) VALUES (
            ${assignment.id}, ${assignment.project_id}, ${assignment.contractor_id},
            ${assignment.team_id}, ${assignment.assignment_type}, ${assignment.scope},
            ${assignment.responsibilities}::jsonb, ${assignment.start_date}, ${assignment.end_date},
            ${assignment.actual_start_date}, ${assignment.actual_end_date}, ${assignment.status},
            ${assignment.performance_rating}, ${assignment.quality_score}, ${assignment.safety_score},
            ${assignment.progress_percentage}, ${assignment.issues_reported}, ${assignment.issues_resolved},
            ${assignment.completion_notes}, ${assignment.created_at}, ${assignment.updated_at}
          ) ON CONFLICT DO NOTHING
        `;
      }
      console.log(`✅ Inserted ${assignments.length} assignments`);
    }
    
    // Generate RAG scores
    console.log('\n📈 Generating RAG scores...');
    const ragScores = await generateRAGScores(contractors);
    console.log(`Generated ${ragScores.length} RAG scores`);
    
    // Create RAG scores table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS contractor_rag_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID NOT NULL REFERENCES contractors(id),
        assessment_date TIMESTAMP NOT NULL,
        performance_score NUMERIC(5,2),
        quality_score NUMERIC(5,2),
        safety_score NUMERIC(5,2),
        compliance_score NUMERIC(5,2),
        financial_score NUMERIC(5,2),
        overall_score NUMERIC(5,2),
        rag_status VARCHAR(10),
        assessment_notes TEXT,
        assessed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    console.log('💾 Inserting RAG scores...');
    for (const score of ragScores) {
      await sql`
        INSERT INTO contractor_rag_scores (
          id, contractor_id, assessment_date, performance_score,
          quality_score, safety_score, compliance_score, financial_score,
          overall_score, rag_status, assessment_notes, assessed_by, created_at
        ) VALUES (
          ${score.id}, ${score.contractor_id}, ${score.assessment_date},
          ${score.performance_score}, ${score.quality_score}, ${score.safety_score},
          ${score.compliance_score}, ${score.financial_score}, ${score.overall_score},
          ${score.rag_status}, ${score.assessment_notes}, ${score.assessed_by},
          ${score.created_at}
        ) ON CONFLICT DO NOTHING
      `;
    }
    console.log(`✅ Inserted ${ragScores.length} RAG scores`);
    
    // Verify insertion
    console.log('\n✅ Data population complete! Verifying...\n');
    
    const counts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM contractors) as contractors,
        (SELECT COUNT(*) FROM contractor_teams) as teams,
        (SELECT COUNT(*) FROM team_members) as members,
        (SELECT COUNT(*) FROM project_assignments) as assignments,
        (SELECT COUNT(*) FROM contractor_rag_scores) as rag_scores
    `;
    
    console.log('📊 Database counts:');
    console.log(`  - Contractors: ${counts[0].contractors}`);
    console.log(`  - Teams: ${counts[0].teams}`);
    console.log(`  - Members: ${counts[0].members}`);
    console.log(`  - Assignments: ${counts[0].assignments}`);
    console.log(`  - RAG Scores: ${counts[0].rag_scores}`);
    
    // Show sample data
    console.log('\n📋 Sample contractor data:');
    const sampleContractors = await sql`
      SELECT company_name, registration_number, bee_level, safety_rating, rag_overall
      FROM contractors
      LIMIT 5
    `;
    console.table(sampleContractors);
    
    console.log('\n✅ Contractor data population completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);