/**
 * Real DOMPurify XSS Sanitization Test
 */
import DOMPurify from 'isomorphic-dompurify';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
  ALLOW_DATA_ATTR: false,
};

function sanitizeText(input) {
  if (!input) return '';
  return DOMPurify.sanitize(input.trim(), SANITIZE_CONFIG);
}

const testCases = [
  {
    name: 'Script tag attack',
    input: '<script>alert(1)</script>Customer Name',
    shouldNotContain: '<script>',
  },
  {
    name: 'Script in order notes',
    input: 'Deliver to <script>alert(1)</script> backdoor',
    shouldNotContain: '<script>',
  },
  {
    name: 'iframe injection in product description',
    input: 'Description <iframe src=x></iframe> text',
    shouldNotContain: '<iframe',
  },
  {
    name: 'Event handler in address',
    input: '<img src=x onerror=alert(1)> 123 Main St',
    shouldNotContain: 'onerror',
  },
  {
    name: 'Plain text preserved',
    input: 'Normal customer name',
    expected: 'Normal customer name',
  },
];

console.log('XSS Sanitization Test Results\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach(test => {
  const result = sanitizeText(test.input);
  let success = false;
  
  if (test.shouldNotContain) {
    success = !result.includes(test.shouldNotContain);
  } else if (test.expected) {
    success = result === test.expected;
  }
  
  console.log('');
  console.log('Test: ' + test.name);
  console.log('Input:  ' + test.input);
  console.log('Output: ' + result);
  console.log('Check:  ' + (test.shouldNotContain ? 'Must not contain: ' + test.shouldNotContain : 'Must equal: ' + test.expected));
  console.log('Status: ' + (success ? 'PASS ✅' : 'FAIL ❌'));
  
  if (success) passed++;
  else failed++;
});

console.log('');
console.log('='.repeat(60));
console.log('Results: ' + passed + '/' + testCases.length + ' passed');
console.log('Success rate: ' + Math.round((passed / testCases.length) * 100) + '%');
