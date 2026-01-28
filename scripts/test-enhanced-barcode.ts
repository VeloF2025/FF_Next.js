/**
 * Test script for Enhanced Barcode Service
 *
 * Usage: npx tsx scripts/test-enhanced-barcode.ts [image-path]
 *
 * Tests the enhanced barcode scanning with:
 * - zxing-wasm for QR, Data Matrix, and 1D barcodes
 * - Multi-pass preprocessing strategies
 * - ONT serial extraction
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  scanBarcodeEnhanced,
  extractOntSerialEnhanced,
  scanAllBarcodes,
  checkEnhancedBarcodeHealth,
} from '../src/modules/activate/services/enhancedBarcodeService';

async function main() {
  console.log('='.repeat(60));
  console.log('Enhanced Barcode Service Test');
  console.log('='.repeat(60));

  // Check service health
  console.log('\n📋 Checking service health...');
  const health = await checkEnhancedBarcodeHealth();
  console.log(`  zxing-wasm: ${health.zxingAvailable ? '✅ Available' : '❌ Not available'}`);
  console.log(`  Quagga2: ${health.quaggaAvailable ? '✅ Available' : '❌ Not available'}`);
  console.log(`  Overall: ${health.available ? '✅ Ready' : '❌ Not ready'}`);

  if (!health.available) {
    console.error('\n❌ Enhanced barcode service not available');
    process.exit(1);
  }

  // Check if test image provided
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.log('\n📖 Usage: npx tsx scripts/test-enhanced-barcode.ts <image-path>');
    console.log('\nExample:');
    console.log('  npx tsx scripts/test-enhanced-barcode.ts /path/to/ont-label.jpg');
    console.log('\nNo image provided - running synthetic test...\n');

    // Run synthetic test with generated barcode
    await runSyntheticTest();
    return;
  }

  // Load and test with provided image
  await runImageTest(imagePath);
}

async function runSyntheticTest() {
  console.log('🧪 Synthetic Test (no image)\n');

  // Test with a simple white image (should return no barcode)
  const { default: sharp } = await import('sharp');

  // Create a 100x100 white image
  const whiteImage = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();

  const base64 = whiteImage.toString('base64');

  console.log('Testing with blank white image (should find no barcode)...');
  const result = await scanBarcodeEnhanced(base64, { quickScan: true });

  console.log(`  Success: ${result.success}`);
  console.log(`  Value: ${result.value || '(none)'}`);
  console.log(`  Format: ${result.format || '(none)'}`);
  console.log(`  Method: ${result.method}`);
  console.log(`  Attempts: ${result.attempts}`);
  console.log(`  Processing time: ${result.processingTimeMs}ms`);

  if (!result.success) {
    console.log('\n✅ Synthetic test passed (correctly found no barcode in blank image)');
  } else {
    console.log('\n⚠️ Unexpected: found barcode in blank image');
  }
}

async function runImageTest(imagePath: string) {
  console.log(`\n📷 Testing image: ${imagePath}\n`);

  // Check file exists
  const resolvedPath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Load image
  const imageBuffer = fs.readFileSync(resolvedPath);
  const base64 = imageBuffer.toString('base64');
  const fileSizeKB = Math.round(imageBuffer.length / 1024);

  console.log(`  File size: ${fileSizeKB} KB`);

  // Test 1: Quick scan
  console.log('\n🔍 Quick Scan (original image only)...');
  const quickResult = await scanBarcodeEnhanced(base64, { quickScan: true });
  printResult(quickResult);

  // Test 2: Full multi-pass scan
  console.log('\n🔍 Full Multi-Pass Scan...');
  const fullResult = await scanBarcodeEnhanced(base64);
  printResult(fullResult);

  // Test 3: ONT serial extraction
  console.log('\n🏷️ ONT Serial Extraction...');
  const ontResult = await extractOntSerialEnhanced(base64);
  console.log(`  Success: ${ontResult.success}`);
  console.log(`  Serial: ${ontResult.serial || '(none)'}`);
  console.log(`  Format: ${ontResult.format || '(none)'}`);
  console.log(`  Confidence: ${(ontResult.confidence * 100).toFixed(1)}%`);
  console.log(`  Method: ${ontResult.method}`);
  console.log(`  Processing time: ${ontResult.processingTimeMs}ms`);

  // Test 4: Scan all barcodes
  console.log('\n📋 Scan All Barcodes...');
  const allResult = await scanAllBarcodes(base64);
  console.log(`  Found: ${allResult.barcodes.length} barcode(s)`);
  console.log(`  Primary serial: ${allResult.primarySerial || '(none)'}`);
  console.log(`  Processing time: ${allResult.processingTimeMs}ms`);

  if (allResult.barcodes.length > 0) {
    console.log('  Barcodes:');
    for (const bc of allResult.barcodes) {
      console.log(`    - ${bc.value} (${bc.format}, ${(bc.confidence * 100).toFixed(0)}%)`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));

  if (fullResult.success || ontResult.success) {
    console.log('✅ Barcode scanning successful!');
    if (ontResult.serial) {
      console.log(`   ONT Serial: ${ontResult.serial}`);
    }
  } else {
    console.log('❌ No barcode found in image');
    console.log('   Try a clearer image with better lighting');
  }
}

function printResult(result: Awaited<ReturnType<typeof scanBarcodeEnhanced>>) {
  console.log(`  Success: ${result.success}`);
  console.log(`  Value: ${result.value || '(none)'}`);
  console.log(`  Format: ${result.format || '(none)'}`);
  console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`  Method: ${result.method}`);
  console.log(`  Attempts: ${result.attempts}`);
  console.log(`  Processing time: ${result.processingTimeMs}ms`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
