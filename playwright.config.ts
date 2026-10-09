import { defineConfig, devices } from '@playwright/test';

export const browserSecret = 'browser-test-only-secret-not-for-runtime-32chars';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3107', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start apps/standalone -H 127.0.0.1 -p 3107',
    url: 'http://127.0.0.1:3107/login',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ASQ_LOCAL_RUNTIME: 'true', ASQ_INSECURE_LOCAL_DEMO_AUTH: 'true',
      ASQ_ADMIN_USERNAME: 'BaoNVG', ASQ_ADMIN_PASSWORD: '1', ASQ_JWT_SECRET: browserSecret },
  },
});
