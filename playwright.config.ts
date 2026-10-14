import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Pixel 7'],
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 120_000 },
});
