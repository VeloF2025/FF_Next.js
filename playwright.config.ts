import { defineConfig, devices } from '@playwright/test';

/**
 * FibreFlow Playwright Configuration
 * E2E and UI testing for the React application
 */
export default defineConfig({
  // Test directory
  testDir: './tests/e2e',

  // Run tests in files in parallel
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Single worker to avoid database conflicts
  workers: 1,

  // Reporter to use
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],

  // Shared settings for all the projects below
  use: {
    // Target dev server by default, override with E2E_BASE_URL env var
    baseURL: process.env.E2E_BASE_URL || 'https://dev.fibreflow.app',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Record video on failure
    video: 'retain-on-failure',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Viewport size
    viewport: { width: 1280, height: 720 },

    // Headless mode
    headless: true,

    // Ignore HTTPS errors for dev/staging
    ignoreHTTPSErrors: true,
  },

  // Configure projects for major browsers
  projects: [
    // Setup project for authentication
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Main test project with auth
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use authenticated state from setup
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // No local webServer needed when testing against dev.fibreflow.app
  // Uncomment below for local testing:
  // webServer: {
  //   command: 'PORT=3005 npm start',
  //   url: 'http://localhost:3005',
  //   reuseExistingServer: true,
  //   timeout: 120 * 1000,
  // },

  // Test timeout
  timeout: 60 * 1000, // 60 seconds for E2E tests

  // Expect timeout
  expect: {
    timeout: 10 * 1000, // 10 seconds
  },

  // Output directory for test results
  outputDir: 'tests/e2e-results/',
});
