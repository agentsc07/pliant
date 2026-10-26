import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  use: { baseURL: "http://localhost:5174", trace: "retain-on-failure" },
  webServer: [
    {
      command: "pnpm --filter chat-backend dev",
      port: 4000,
      reuseExistingServer: !process.env.CI,
      env: { PLIANT_MOCK: "1", CHAT_DB: ":memory:", PLIANT_DB: ":memory:" },
    },
    { command: "pnpm --filter chat-pliant dev", port: 5174, reuseExistingServer: !process.env.CI },
  ],
});
