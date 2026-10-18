import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:3003",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3003",
    url: "http://127.0.0.1:3003",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      LOOPPILOT_TEST_BUILD_DIR: ".next-preview",
      LOOPPILOT_CHATGPT_LOCAL: "1",
      LOOPPILOT_LOCAL_ORIGIN: "http://127.0.0.1:3003",
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
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
