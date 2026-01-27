/**
 * Vitest config for integration tests
 *
 * This config does NOT mock the database - it uses real connections.
 * Run with: npm run test:integration
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

// Load real environment variables
dotenv.config({ path: '.env.local' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Use node, not jsdom for backend tests
    include: ['**/*.integration.test.ts', '**/integration.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // No setupFiles - we want real database connections
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/lib': path.resolve(__dirname, './lib'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/contexts': path.resolve(__dirname, './src/contexts'),
      '@/services': path.resolve(__dirname, './src/services'),
      '@/modules': path.resolve(__dirname, './src/modules'),
      '@/pages': path.resolve(__dirname, './pages'),
      '@/config': path.resolve(__dirname, './src/config'),
    },
  },
});
