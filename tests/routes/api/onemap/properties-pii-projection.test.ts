import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROPERTY_ENDPOINTS = [
  'pages/api/onemap/properties.ts',
  'pages/api/onemap/properties-enhanced.ts',
  'pages/api/onemap/properties-with-mapping.ts',
];

const SUBSCRIBER_IDENTITY_COLUMNS = [
  'contact_name',
  'contact_surname',
  'contact_number',
  'email_address',
  'id_number',
];

describe('1Map property endpoint privacy boundary', () => {
  for (const relativePath of PROPERTY_ENDPOINTS) {
    it(`${relativePath} uses an explicit projection without subscriber identity fields`, () => {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

      expect(source).not.toMatch(/\bop\.\*/i);
      for (const column of SUBSCRIBER_IDENTITY_COLUMNS) {
        expect(source).not.toContain(column);
      }
    });
  }
});
