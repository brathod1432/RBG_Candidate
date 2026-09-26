// e2e/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect if running on Windows
const isWindows = process.platform === "win32";

// Get system Chrome/Edge path on Windows
function getSystemChromePath(): string | undefined {
  if (!isWindows) return undefined;
  
  const { existsSync } = require("fs");
  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  
  for (const p of chromePaths) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const systemChromePath = getSystemChromePath();

export default defineConfig({
  testDir: "./",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
  ],
  use: {
    baseURL: "http://localhost:34567",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { 
        ...devices["Desktop Chrome"],
        // On Windows, use system Chrome if available for extension support
        ...(isWindows && systemChromePath ? { executablePath: systemChromePath } : {}),
      },
    },
    // Additional project for headed debugging
    {
      name: "chromium-headed",
      use: { 
        ...devices["Desktop Chrome"],
        headless: false,
        ...(isWindows && systemChromePath ? { executablePath: systemChromePath } : {}),
      },
    },
  ],
  timeout: 120000,
  expect: {
    timeout: 10000,
  },
  outputDir: "test-results",
});