import * as fs from 'fs';
import sharp from 'sharp';

const VLM_MAX_WIDTH = 1280;
const VLM_MAX_HEIGHT = 960;
const VLM_JPEG_QUALITY = 85;

async function resizeImageForVlm(base64Image: string): Promise<string> {
  const inputBuffer = Buffer.from(base64Image, 'base64');
  const metadata = await sharp(inputBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width <= VLM_MAX_WIDTH && height <= VLM_MAX_HEIGHT) {
    console.log(`Image ${width}x${height} already within limits`);
    return base64Image;
  }

  console.log(`Resizing image from ${width}x${height} to max ${VLM_MAX_WIDTH}x${VLM_MAX_HEIGHT}`);

  const resizedBuffer = await sharp(inputBuffer)
    .resize(VLM_MAX_WIDTH, VLM_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: VLM_JPEG_QUALITY })
    .toBuffer();

  const originalSize = Math.round(inputBuffer.length / 1024);
  const resizedSize = Math.round(resizedBuffer.length / 1024);
  console.log(`Image resized: ${originalSize}KB -> ${resizedSize}KB (${Math.round(resizedSize/originalSize*100)}%)`);

  return resizedBuffer.toString('base64');
}

async function testVlm(imagePath: string, prompt: string, label: string) {
  const base64Original = fs.readFileSync(imagePath).toString('base64');
  
  // Apply resize (simulating the fix)
  const base64Resized = await resizeImageForVlm(base64Original);
  
  const requestBody = {
    model: 'QuantTrio/Qwen3-VL-32B-Instruct-AWQ',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64Resized } }
      ]
    }],
    max_tokens: 500,
    temperature: 0.1
  };
  
  const start = Date.now();
  const response = await fetch('http://100.96.203.105:8100/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const elapsed = Date.now() - start;
  
  if (response.status !== 200) {
    console.log(label + ': HTTP ' + response.status);
    return;
  }
  
  const data = await response.json();
  console.log('\n=== ' + label + ' (' + elapsed + 'ms) ===');
  console.log(data.choices?.[0]?.message?.content || 'No content');
}

const ODOMETER_PROMPT = `You are analyzing a vehicle dashboard/odometer photo.

TASK: Extract the odometer/mileage reading from this photo.

RESPONSE FORMAT (JSON only, no other text):
{
  "reading": 123456,
  "confidence": 0.95,
  "raw_text": "123,456 km"
}`;

const FUEL_PROMPT = `Look at this vehicle dashboard photo. Find the FUEL GAUGE.

HOW TO IDENTIFY THE FUEL GAUGE:
- Has "E" (Empty) on one side and "F" (Full) on the other
- Usually has a fuel pump icon nearby

TASK: Where is the fuel gauge needle pointing? Estimate the tank percentage (0-100%).

Reply with JSON only:
{"level": <0-100>, "confidence": <0.0-1.0>, "description": "<brief description>"}`;

async function main() {
  console.log('=== Testing WITH auto-resize fix (simulating production) ===\n');
  
  // Test 4K dashboard image with resize
  await testVlm('/tmp/dashboard_bad.jpg', ODOMETER_PROMPT, 'DASHBOARD (4K→resized)');
  
  // Test 4K fuel image with resize
  await testVlm('/tmp/fuel_bad.jpg', FUEL_PROMPT, 'FUEL GAUGE (4K→resized)');
}

main().catch(console.error);
