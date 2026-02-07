/**
 * Test script for supplier API endpoints
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'process.env.DATABASE_URL';

// Set the DATABASE_URL environment variable for the service
process.env.DATABASE_URL = DATABASE_URL;

// Import the service
const { NeonSupplierService } = require('../src/services/suppliers/neonSupplierService');

async function testAPIs() {
  console.log('🧪 Testing Supplier APIs...\n');
  
  try {
    // Test 1: Get all suppliers
    console.log('📋 Test 1: Get all suppliers');
    const allSuppliers = await NeonSupplierService.getAll();
    console.log(`✅ Found ${allSuppliers.length} suppliers`);
    allSuppliers.forEach(s => {
      console.log(`   - ${s.code}: ${s.name} (${s.status})`);
    });
    
    // Test 2: Get supplier by ID
    console.log('\n📋 Test 2: Get supplier by ID');
    if (allSuppliers.length > 0) {
      const supplier = await NeonSupplierService.getById(allSuppliers[0].id);
      console.log(`✅ Retrieved supplier: ${supplier.name}`);
      console.log(`   Email: ${supplier.email}`);
      console.log(`   Status: ${supplier.status}`);
      console.log(`   Type: ${supplier.businessType}`);
    }
    
    // Test 3: Search suppliers
    console.log('\n📋 Test 3: Search suppliers by status');
    const activeSuppliers = await NeonSupplierService.getAll({ status: 'active' });
    console.log(`✅ Found ${activeSuppliers.length} active suppliers`);
    
    // Test 4: Create new supplier
    console.log('\n📋 Test 4: Create new supplier');
    const newSupplierId = await NeonSupplierService.create({
      name: 'Test Supplier ' + Date.now(),
      email: 'test' + Date.now() + '@example.com',
      phone: '+27 11 000 0000',
      status: 'pending',
      businessType: 'service_provider',
      categories: ['Testing'],
      primaryContact: {
        name: 'Test Contact',
        email: 'contact@test.com',
        phone: '+27 82 000 0000'
      },
      addresses: {
        physical: {
          street1: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          postalCode: '0000',
          country: 'South Africa'
        }
      }
    }, 'test-user');
    console.log(`✅ Created supplier with ID: ${newSupplierId}`);
    
    // Test 5: Update supplier
    console.log('\n📋 Test 5: Update supplier');
    await NeonSupplierService.update(newSupplierId, {
      notes: 'Updated via test script',
      status: 'active'
    }, 'test-user');
    console.log('✅ Supplier updated successfully');
    
    // Test 6: Add rating
    console.log('\n📋 Test 6: Add supplier rating');
    await NeonSupplierService.updateRating(allSuppliers[0].id, {
      overall: 4.0,
      quality: 4.5,
      delivery: 3.8,
      pricing: 4.2,
      communication: 4.6
    }, 'test-user');
    console.log('✅ Rating added successfully');
    
    // Test 7: Add compliance document
    console.log('\n📋 Test 7: Add compliance document');
    await NeonSupplierService.addComplianceDocument(
      allSuppliers[0].id,
      {
        type: 'insurance',
        name: 'Insurance Certificate 2024',
        url: 'https://example.com/insurance.pdf',
        expiryDate: new Date('2025-12-31')
      },
      'test-user'
    );
    console.log('✅ Compliance document added successfully');
    
    // Test 8: Add product
    console.log('\n📋 Test 8: Add product');
    await NeonSupplierService.addProduct(allSuppliers[0].id, {
      code: 'TEST-' + Date.now(),
      name: 'Test Product',
      description: 'Product added via test script',
      category: 'Test Category',
      unitPrice: 999.99,
      minOrderQuantity: 5
    });
    console.log('✅ Product added successfully');
    
    // Test 9: Get statistics
    console.log('\n📋 Test 9: Get statistics');
    const stats = await NeonSupplierService.getStatistics();
    console.log('✅ Statistics retrieved:');
    console.log(`   Total: ${stats.total}`);
    console.log(`   Active: ${stats.active}`);
    console.log(`   Pending: ${stats.pending}`);
    console.log(`   Preferred: ${stats.preferred}`);
    console.log(`   Blacklisted: ${stats.blacklisted}`);
    
    // Test 10: Soft delete
    console.log('\n📋 Test 10: Soft delete supplier');
    await NeonSupplierService.softDelete(newSupplierId, 'Test deletion', 'test-user');
    console.log('✅ Supplier soft deleted successfully');
    
    // Verify soft delete
    const deletedSupplier = await NeonSupplierService.getById(newSupplierId);
    console.log(`   Status after soft delete: ${deletedSupplier.status}`);
    console.log(`   Is Active: ${deletedSupplier.isActive}`);
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testAPIs().catch(console.error);