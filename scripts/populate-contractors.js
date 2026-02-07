#!/usr/bin/env node

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';
import { faker } from '@faker-js/faker';

// Database connection
const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);
const db = drizzle(sql);

// Set South African locale for realistic data
faker.locale = 'en_ZA';

// Utility functions
const generateCIPCNumber = () => {
  const year = faker.date.between({ from: '2015-01-01', to: '2023-12-31' }).getFullYear();
  const number = faker.number.int({ min: 100000, max: 999999 });
  return `${year}/${number}/07`;
};

const generateVATNumber = () => {
  return `4${faker.number.int({ min: 100000000, max: 999999999 })}`;
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
  return 4; // Default to level 4
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

// Main data generation functions
async function generateContractors() {
  const contractors = [];
  
  for (let i = 0; i < contractorCompanyNames.length; i++) {
    const companyName = contractorCompanyNames[i];
    const city = faker.helpers.arrayElement(cities);
    
    const contractor = {
      id: uuidv4(),
      companyName,
      registrationNumber: generateCIPCNumber(),
      contactPerson: `${faker.helpers.arrayElement(saFirstNames)} ${faker.helpers.arrayElement(saLastNames)}`,
      email: `info@${companyName.toLowerCase().replace(/\s+/g, '')}.co.za`,
      phone: `0${faker.number.int({ min: 11, max: 87 })}${faker.number.int({ min: 1000000, max: 9999999 })}`,
      alternativePhone: Math.random() > 0.5 ? `0${faker.number.int({ min: 11, max: 87 })}${faker.number.int({ min: 1000000, max: 9999999 })}` : null,
      address: `${faker.number.int({ min: 1, max: 999 })} ${faker.location.street()}`,
      city,
      province: getProvinceForCity(city),
      postalCode: faker.number.int({ min: 1000, max: 9999 }).toString(),
      website: Math.random() > 0.3 ? `https://www.${companyName.toLowerCase().replace(/\s+/g, '')}.co.za` : null,
      vatNumber: generateVATNumber(),
      beeLevel: generateBBBEELevel(),
      beeExpiryDate: faker.date.between({ from: '2025-01-01', to: '2026-12-31' }).toISOString(),
      numberOfEmployees: faker.number.int({ min: 10, max: 200 }),
      establishedDate: faker.date.between({ from: '2010-01-01', to: '2022-12-31' }).toISOString(),
      bankName: faker.helpers.arrayElement(['FNB', 'Standard Bank', 'ABSA', 'Nedbank', 'Capitec']),
      bankAccountNumber: faker.number.int({ min: 1000000000, max: 9999999999 }).toString(),
      bankBranchCode: faker.number.int({ min: 100000, max: 999999 }).toString(),
      insuranceProvider: faker.helpers.arrayElement(['Santam', 'Old Mutual', 'Discovery', 'Hollard', 'OUTsurance']),
      insurancePolicyNumber: `POL${faker.number.int({ min: 100000, max: 999999 })}`,
      insuranceExpiryDate: faker.date.between({ from: '2025-03-01', to: '2026-12-31' }).toISOString(),
      safetyRating: faker.number.float({ min: 65, max: 98, multipleOf: 0.1 }),
      qualityScore: faker.number.float({ min: 70, max: 95, multipleOf: 0.1 }),
      onTimeDelivery: faker.number.float({ min: 75, max: 98, multipleOf: 0.1 }),
      ragPerformance: faker.helpers.arrayElement(['Green', 'Amber', 'Green', 'Green']), // Weighted toward Green
      ragQuality: faker.helpers.arrayElement(['Green', 'Green', 'Amber', 'Green']),
      ragSafety: faker.helpers.arrayElement(['Green', 'Green', 'Green', 'Amber']),
      ragOverall: faker.helpers.arrayElement(['Green', 'Green', 'Amber', 'Green']),
      status: faker.helpers.arrayElement(['Active', 'Active', 'Active', 'Pending']),
      notes: Math.random() > 0.7 ? faker.lorem.sentence() : null,
      capabilities: JSON.stringify(faker.helpers.arrayElements(specializations, { min: 2, max: 5 })),
      certifications: JSON.stringify(['CIDB', 'ISO 9001', 'OHSAS 18001'].filter(() => Math.random() > 0.3)),
      preferredPaymentTerms: faker.helpers.arrayElement(['30 days', '60 days', '45 days']),
      creditLimit: faker.number.int({ min: 100000, max: 5000000 }),
      createdBy: 'system',
      updatedBy: 'system',
      createdAt: faker.date.past({ years: 2 }).toISOString(),
      updatedAt: faker.date.recent({ days: 30 }).toISOString()
    };
    
    contractors.push(contractor);
  }
  
  return contractors;
}

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

async function generateTeams(contractors) {
  const teams = [];
  
  for (const contractor of contractors) {
    const teamCount = faker.number.int({ min: 2, max: 3 });
    
    for (let i = 0; i < teamCount; i++) {
      const teamType = faker.helpers.arrayElement(teamTypes);
      const team = {
        id: uuidv4(),
        contractorId: contractor.id,
        teamName: `${contractor.companyName.split(' ')[0]} ${teamType} Team ${i + 1}`,
        teamType,
        specialization: faker.helpers.arrayElement(specializations),
        maxCapacity: faker.number.int({ min: 5, max: 15 }),
        currentCapacity: faker.number.int({ min: 3, max: 12 }),
        leaderId: uuidv4(), // Will be linked to a team member
        vehicleCount: faker.number.int({ min: 1, max: 4 }),
        equipmentList: JSON.stringify([
          'Fiber splicer', 'OTDR', 'Power meter', 'Cable blower', 'Trenching equipment'
        ].filter(() => Math.random() > 0.3)),
        certifications: JSON.stringify(['Safety Certificate', 'Technical Training'].filter(() => Math.random() > 0.4)),
        status: faker.helpers.arrayElement(['Active', 'Active', 'Active', 'On Assignment']),
        performanceScore: faker.number.float({ min: 70, max: 95, multipleOf: 0.1 }),
        baseLocation: `${contractor.city}, ${contractor.province}`,
        operatingRadius: faker.number.int({ min: 20, max: 100 }),
        createdAt: contractor.createdAt,
        updatedAt: faker.date.recent({ days: 30 }).toISOString()
      };
      
      teams.push(team);
    }
  }
  
  return teams;
}

async function generateTeamMembers(teams, contractors) {
  const members = [];
  
  for (const team of teams) {
    const contractor = contractors.find(c => c.id === team.contractorId);
    const memberCount = faker.number.int({ min: 5, max: 10 });
    
    for (let i = 0; i < memberCount; i++) {
      const firstName = faker.helpers.arrayElement(saFirstNames);
      const lastName = faker.helpers.arrayElement(saLastNames);
      const isLeader = i === 0; // First member is team leader
      
      const member = {
        id: isLeader ? team.leaderId : uuidv4(),
        teamId: team.id,
        contractorId: team.contractorId,
        firstName,
        lastName,
        idNumber: generateSAIDNumber(),
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${contractor.companyName.toLowerCase().replace(/\s+/g, '')}.co.za`,
        phone: `0${faker.number.int({ min: 60, max: 84 })}${faker.number.int({ min: 1000000, max: 9999999 })}`,
        role: isLeader ? 'Team Leader' : faker.helpers.arrayElement(['Technician', 'Senior Technician', 'Assistant', 'Driver']),
        skills: JSON.stringify(faker.helpers.arrayElements([
          'Fiber Splicing', 'Cable Installation', 'Testing', 'Trenching', 
          'Safety Management', 'Quality Control', 'Documentation'
        ], { min: 2, max: 4 })),
        certifications: JSON.stringify(faker.helpers.arrayElements([
          'Working at Heights', 'First Aid', 'Fiber Optic Certified', 'Safety Rep'
        ], { min: 1, max: 3 })),
        yearsExperience: faker.number.int({ min: 1, max: 15 }),
        emergencyContact: `0${faker.number.int({ min: 60, max: 84 })}${faker.number.int({ min: 1000000, max: 9999999 })}`,
        emergencyContactName: `${faker.helpers.arrayElement(saFirstNames)} ${lastName}`,
        bloodType: faker.helpers.arrayElement(['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']),
        medicalConditions: Math.random() > 0.8 ? faker.lorem.sentence() : null,
        status: faker.helpers.arrayElement(['Active', 'Active', 'Active', 'On Leave']),
        performanceRating: faker.number.float({ min: 65, max: 95, multipleOf: 0.1 }),
        safetyScore: faker.number.float({ min: 70, max: 100, multipleOf: 0.1 }),
        createdAt: team.createdAt,
        updatedAt: faker.date.recent({ days: 30 }).toISOString()
      };
      
      members.push(member);
    }
  }
  
  return members;
}

function generateSAIDNumber() {
  // Generate realistic SA ID number (13 digits)
  const year = faker.number.int({ min: 70, max: 99 }); // Birth year
  const month = faker.number.int({ min: 1, max: 12 }).toString().padStart(2, '0');
  const day = faker.number.int({ min: 1, max: 28 }).toString().padStart(2, '0');
  const sequence = faker.number.int({ min: 0, max: 4999 }).toString().padStart(4, '0');
  const citizenship = faker.helpers.arrayElement(['0', '1']); // 0 = SA citizen, 1 = permanent resident
  const checksum = faker.number.int({ min: 0, max: 9 });
  
  return `${year}${month}${day}${sequence}${citizenship}8${checksum}`;
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
    // Generate sample project IDs if none exist
    return Array.from({ length: 20 }, (_, i) => ({
      id: `PROJ-2025-${(i + 1).toString().padStart(3, '0')}`,
      project_name: `Sample Project ${i + 1}`
    }));
  }
}

async function generateProjectAssignments(contractors, teams, projects) {
  const assignments = [];
  
  for (const project of projects) {
    // Assign 2-4 contractors per project
    const assignedContractors = faker.helpers.arrayElements(contractors, { min: 2, max: 4 });
    
    for (const contractor of assignedContractors) {
      const contractorTeams = teams.filter(t => t.contractorId === contractor.id);
      const assignedTeam = faker.helpers.arrayElement(contractorTeams);
      
      const startDate = faker.date.between({ from: '2024-01-01', to: '2024-12-31' });
      const endDate = faker.date.between({ from: startDate, to: '2025-12-31' });
      
      const assignment = {
        id: uuidv4(),
        projectId: project.id,
        contractorId: contractor.id,
        teamId: assignedTeam ? assignedTeam.id : null,
        assignmentType: faker.helpers.arrayElement(['Primary', 'Secondary', 'Support']),
        scope: generateScope(),
        responsibilities: JSON.stringify([
          'Fiber installation',
          'Quality control',
          'Safety compliance',
          'Progress reporting',
          'Material management'
        ].filter(() => Math.random() > 0.3)),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        actualStartDate: startDate.toISOString(),
        actualEndDate: Math.random() > 0.5 ? faker.date.between({ from: startDate, to: new Date() }).toISOString() : null,
        status: faker.helpers.arrayElement(['Active', 'Completed', 'In Progress', 'Active']),
        performanceRating: faker.number.float({ min: 70, max: 95, multipleOf: 0.1 }),
        qualityScore: faker.number.float({ min: 75, max: 98, multipleOf: 0.1 }),
        safetyScore: faker.number.float({ min: 80, max: 100, multipleOf: 0.1 }),
        progressPercentage: faker.number.int({ min: 10, max: 100 }),
        issuesReported: faker.number.int({ min: 0, max: 5 }),
        issuesResolved: faker.number.int({ min: 0, max: 5 }),
        completionNotes: Math.random() > 0.7 ? faker.lorem.sentence() : null,
        createdAt: startDate.toISOString(),
        updatedAt: faker.date.recent({ days: 30 }).toISOString()
      };
      
      assignments.push(assignment);
    }
  }
  
  return assignments;
}

function generateScope() {
  const scopes = [
    'Installation of fiber optic cables for residential areas',
    'Trenching and ducting for main fiber routes',
    'Pole installation and maintenance services',
    'Drop cable installation to customer premises',
    'Fiber splicing and testing services',
    'Network maintenance and fault repairs',
    'Quality assurance and testing',
    'Civil works for fiber infrastructure',
    'Emergency response and repairs'
  ];
  
  return faker.helpers.arrayElement(scopes);
}

async function generateRAGScores(contractors) {
  const ragScores = [];
  
  for (const contractor of contractors) {
    // Generate historical scores for last 12 months
    for (let month = 0; month < 12; month++) {
      const recordDate = new Date();
      recordDate.setMonth(recordDate.getMonth() - month);
      
      const score = {
        id: uuidv4(),
        contractorId: contractor.id,
        assessmentDate: recordDate.toISOString(),
        performanceScore: faker.number.float({ min: 65, max: 95, multipleOf: 0.1 }),
        qualityScore: faker.number.float({ min: 70, max: 98, multipleOf: 0.1 }),
        safetyScore: faker.number.float({ min: 75, max: 100, multipleOf: 0.1 }),
        complianceScore: faker.number.float({ min: 80, max: 100, multipleOf: 0.1 }),
        financialScore: faker.number.float({ min: 70, max: 95, multipleOf: 0.1 }),
        overallScore: null, // Will be calculated
        ragStatus: null, // Will be calculated
        assessmentNotes: Math.random() > 0.7 ? faker.lorem.sentence() : null,
        assessedBy: 'System',
        createdAt: recordDate.toISOString()
      };
      
      // Calculate overall score
      score.overallScore = (
        score.performanceScore * 0.3 +
        score.qualityScore * 0.25 +
        score.safetyScore * 0.25 +
        score.complianceScore * 0.1 +
        score.financialScore * 0.1
      ).toFixed(2);
      
      // Determine RAG status
      if (score.overallScore >= 80) score.ragStatus = 'Green';
      else if (score.overallScore >= 65) score.ragStatus = 'Amber';
      else score.ragStatus = 'Red';
      
      ragScores.push(score);
    }
  }
  
  return ragScores;
}

// Database insertion functions
async function insertData(tableName, data) {
  if (!data || data.length === 0) {
    console.log(`No data to insert for ${tableName}`);
    return;
  }
  
  try {
    // Insert in batches of 10
    const batchSize = 10;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      const columns = Object.keys(batch[0]);
      const values = batch.map(row => 
        columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
          if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
          return val;
        }).join(', ')
      );
      
      const query = `
        INSERT INTO ${tableName} (${columns.join(', ')})
        VALUES ${values.map(v => `(${v})`).join(', ')}
        ON CONFLICT DO NOTHING
      `;
      
      await sql(query);
      console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1} into ${tableName}`);
    }
    
    console.log(`✅ Successfully inserted ${data.length} records into ${tableName}`);
  } catch (error) {
    console.error(`❌ Error inserting into ${tableName}:`, error.message);
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting contractor data population...\n');
  
  try {
    // Generate data
    console.log('📊 Generating contractor companies...');
    const contractors = await generateContractors();
    console.log(`Generated ${contractors.length} contractors`);
    
    console.log('👥 Generating contractor teams...');
    const teams = await generateTeams(contractors);
    console.log(`Generated ${teams.length} teams`);
    
    console.log('👤 Generating team members...');
    const members = await generateTeamMembers(teams, contractors);
    console.log(`Generated ${members.length} team members`);
    
    console.log('📋 Getting project IDs...');
    const projects = await getProjectIds();
    console.log(`Found ${projects.length} projects`);
    
    console.log('🔗 Generating project assignments...');
    const assignments = await generateProjectAssignments(contractors, teams, projects);
    console.log(`Generated ${assignments.length} assignments`);
    
    console.log('📈 Generating RAG scores...');
    const ragScores = await generateRAGScores(contractors);
    console.log(`Generated ${ragScores.length} RAG scores`);
    
    // Insert data into database
    console.log('\n💾 Inserting data into database...\n');
    
    await insertData('contractors', contractors);
    await insertData('contractor_teams', teams);
    await insertData('team_members', members);
    await insertData('project_assignments', assignments);
    
    // Create contractor_rag_scores table if it doesn't exist
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
    
    await insertData('contractor_rag_scores', ragScores);
    
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