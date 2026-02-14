/**
 * Test script for XSS sanitization
 * Tests that malicious HTML/script tags are stripped from user inputs
 */

const { sanitizeText, sanitizeClientData, containsXssPatterns } = require('./src/lib/security/sanitization');

console.log('=== XSS Sanitization Test Suite ===\n');

// Test 1: Basic script tag
const test1 = '<script>alert(1)</script>';
const result1 = sanitizeText(test1);
console.log('Test 1: Basic script tag');
console.log('Input:', test1);
console.log('Output:', result1);
console.log('Passed:', result1 === '' || !result1.includes('<script'));
console.log('');

// Test 2: Script in customer name
const test2 = 'John Doe<script>alert("XSS")</script>';
const result2 = sanitizeText(test2);
console.log('Test 2: Script in customer name');
console.log('Input:', test2);
console.log('Output:', result2);
console.log('Passed:', result2 === 'John Doe');
console.log('');

// Test 3: Event handler
const test3 = '<img src=x onerror=alert(1)>';
const result3 = sanitizeText(test3);
console.log('Test 3: Event handler');
console.log('Input:', test3);
console.log('Output:', result3);
console.log('Passed:', !result3.includes('onerror'));
console.log('');

// Test 4: Iframe injection
const test4 = '<iframe src="javascript:alert(1)"></iframe>';
const result4 = sanitizeText(test4);
console.log('Test 4: Iframe injection');
console.log('Input:', test4);
console.log('Output:', result4);
console.log('Passed:', !result4.includes('iframe'));
console.log('');

// Test 5: Client data sanitization
const clientData = {
  name: 'Test Company<script>alert(1)</script>',
  email: 'test@example.com<script>alert(1)</script>',
  address: '123 Main St<img src=x onerror=alert(1)>',
  notes: '<b>Bold text</b><script>evil()</script>'
};
const sanitizedClient = sanitizeClientData(clientData);
console.log('Test 5: Client data object sanitization');
console.log('Input name:', clientData.name);
console.log('Output name:', sanitizedClient.name);
console.log('Input address:', clientData.address);
console.log('Output address:', sanitizedClient.address);
console.log('Passed:', !sanitizedClient.name.includes('<script') && !sanitizedClient.address.includes('onerror'));
console.log('');

// Test 6: XSS pattern detection
const xssTests = [
  '<script>alert(1)</script>',
  'javascript:alert(1)',
  '<img onerror=alert(1)>',
  'normal text'
];
console.log('Test 6: XSS pattern detection');
xssTests.forEach(test => {
  console.log(`Input: ${test} - Contains XSS: ${containsXssPatterns(test)}`);
});
console.log('');

console.log('=== All Tests Complete ===');
