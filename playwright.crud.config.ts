import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-crud",
  use: { baseURL: "http://127.0.0.1:3002", channel: "chromium" },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3002",
    url: "http://127.0.0.1:3002",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      LOOPPILOT_TEST_BUILD_DIR: ".next-crud",
      LOOPPILOT_CHATGPT_LOCAL: "0",
      NEXT_PUBLIC_SUPABASE_URL: "https://looppilot-e2e.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-public-key",
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "wide", use: { viewport: { width: 1920, height: 1080 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
