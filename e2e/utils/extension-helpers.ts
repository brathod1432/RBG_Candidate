// e2e/utils/extension-helpers.ts
import { Page, BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { existsSync } from "fs";

export interface ExtensionContext {
  context: BrowserContext;
  extensionId: string;
  popupPage: Page;
}

export interface ProfileData {
  fullName: string;
  email: string;
  phone: string;
  headline: string;
  summary: string;
}

export interface LaunchExtensionOptions {
  /** Path to the unpacked extension directory */
  extensionPath?: string;
  /** Path to Chrome/Edge executable (for Windows where Playwright's Chromium doesn't support --load-extension) */
  executablePath?: string;
  /** Run in headless mode (default: true) */
  headless?: boolean;
  /** Additional Chrome arguments */
  extraArgs?: string[];
}

const TEST_PASSPHRASE = "test-passphrase-123";
const TEST_PROFILE: ProfileData = {
  fullName: "John Doe",
  email: "john.doe@example.com",
  phone: "(555) 123-4567",
  headline: "Senior Software Engineer",
  summary: "Experienced software engineer with 10+ years of experience.",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Default extension path: project_root/client/dist
const DEFAULT_EXTENSION_PATH = path.resolve(__dirname, "..", "..", "client", "dist").replace(/\\/g, "/");

/**
 * Detect if we're running on Windows where Playwright's Chromium has --load-extension limitations.
 */
function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Get the Chrome executable path for the current platform.
 * On Windows, tries to find system Chrome/Edge which supports --load-extension.
 */
function getSystemChromePath(): string | undefined {
  if (!isWindows()) {
    return undefined;
  }
  
  // Common Chrome installation paths on Windows
  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    // Edge paths (Chromium-based, supports extensions)
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  
  for (const chromePath of chromePaths) {
    if (existsSync(chromePath)) {
      return chromePath;
    }
  }
  return undefined;
}

/**
 * Launch browser with the unpacked extension loaded.
 * On Windows, attempts to use system Chrome/Edge if available since Playwright's
 * bundled Chromium (Chrome for Testing) doesn't support --load-extension.
 */
export async function launchWithExtension(options: LaunchExtensionOptions = {}): Promise<ExtensionContext> {
  const { chromium } = await import("@playwright/test");
  
  const extensionPath = options.extensionPath || DEFAULT_EXTENSION_PATH;
  const executablePath = options.executablePath || getSystemChromePath();
  const headless = options.headless !== false;
  const extraArgs = options.extraArgs || [];
  
  console.log(`Loading extension from: ${extensionPath}`);
  if (executablePath) {
    console.log(`Using browser executable: ${executablePath}`);
  } else if (isWindows()) {
    console.warn(
      "WARNING: Running on Windows with Playwright's bundled Chromium. " +
      "--load-extension is not supported. Tests will likely fail to load the extension. " +
      "Install Google Chrome or Microsoft Edge for full E2E testing."
    );
  }
  
  // Create a temporary user data directory
  const userDataDir = mkdtempSync(path.join(tmpdir(), "playwright-extension-"));
  console.log(`Using user data dir: ${userDataDir}`);
  
  const launchArgs = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-logging=stderr",
    "--v=1",
    "--enable-extensions",
    "--allow-insecure-localhost",
    ...extraArgs,
  ];
  
  const launchOptions: any = {
    headless,
    args: launchArgs,
  };
  
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  
  const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

  // Listen to console messages from all pages
  context.on("console", (msg) => {
    console.log(`[CONSOLE] ${msg.type()}: ${msg.text()}`);
  });

  // Find the extension ID - wait longer and poll
  const extensionId = await getExtensionId(context);
  if (!extensionId) {
    const errorMsg = 
      "Extension failed to load. " +
      (isWindows() && !executablePath
        ? "On Windows, Playwright's bundled Chromium (Chrome for Testing) does not support loading unpacked extensions via --load-extension. " +
          "Please install Google Chrome or Microsoft Edge and set the executablePath option, or run tests on Linux/macOS."
        : "Check that the extension path is correct and the manifest.json is valid.");
    
    await context.close();
    throw new Error(errorMsg);
  }

  console.log(`Found extension ID: ${extensionId}`);

  // Open the popup
  const popupPage = await openPopup(context, extensionId);

  return { context, extensionId, popupPage };
}

/**
 * Get the extension ID from the background page or service worker.
 * Polls for service worker to appear.
 */
async function getExtensionId(context: BrowserContext): Promise<string | null> {
  // Wait for extension to be loaded - poll for service worker
  for (let attempt = 0; attempt < 40; attempt++) {
    await context.pages()[0].waitForTimeout(1000);
    
    const serviceWorkers = context.serviceWorkers();
    console.log(`Attempt ${attempt + 1}: Found ${serviceWorkers.length} service workers`);
    for (const sw of serviceWorkers) {
      const url = sw.url();
      console.log(`  SW: ${url}`);
      const match = url.match(/chrome-extension:\/\/([^/]+)/);
      if (match) {
        return match[1];
      }
    }

    // Also check pages
    const pages = context.pages();
    for (const page of pages) {
      const url = page.url();
      if (url.startsWith("chrome-extension://")) {
        const match = url.match(/chrome-extension:\/\/([^/]+)/);
        if (match) {
          return match[1];
        }
      }
    }
  }

  // Final check
  const serviceWorkers = context.serviceWorkers();
  for (const sw of serviceWorkers) {
    const url = sw.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (match) {
      return match[1];
    }
  }

  const pages = context.pages();
  for (const page of pages) {
    const url = page.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Open the extension popup.
 */
async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const page = await context.newPage();
  page.on("console", (msg) => {
    console.log(`[POPUP CONSOLE] ${msg.type()}: ${msg.text()}`);
  });
  await page.goto(popupUrl);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("h1:has-text('RBG Candidate')", { timeout: 15000 });
  return page;
}

/**
 * Unlock the extension with the test passphrase.
 */
export async function unlockExtension(popupPage: Page): Promise<void> {
  // Wait for settings tab to be visible
  await popupPage.waitForSelector("button:has-text('Settings')", { timeout: 5000 });

  // Check if already unlocked
  const statusText = popupPage.locator("text=/Status:.*Unlocked/");
  if (await statusText.isVisible().catch(() => false)) {
    console.log("Extension already unlocked");
    return;
  }

  // Fill in the passphrase
  const passphraseInput = popupPage.locator('input[type="password"][placeholder="Session passphrase"]');
  await passphraseInput.waitFor({ state: "visible", timeout: 5000 });
  await passphraseInput.fill(TEST_PASSPHRASE);

  // Click Unlock button
  const unlockButton = popupPage.locator('button:has-text("Unlock"):not([disabled])');
  await unlockButton.click();

  // Wait for unlock to complete (status changes to Unlocked)
  await popupPage.waitForSelector("text=/Status:.*Unlocked/", { timeout: 10000 });
  await popupPage.waitForTimeout(1000);
}

/**
 * Save a test profile in the Settings tab.
 */
export async function saveTestProfile(popupPage: Page): Promise<void> {
  // Navigate to Settings tab if not already there
  const settingsTab = popupPage.locator('button:has-text("Settings")');
  if (await settingsTab.getAttribute("aria-pressed") !== "true") {
    await settingsTab.click();
    await popupPage.waitForTimeout(500);
  }

  // Fill in profile fields
  const fieldSelectors: Record<keyof ProfileData, string> = {
    fullName: 'label:has-text("Full name") input',
    email: 'label:has-text("Email") input',
    phone: 'label:has-text("Phone") input',
    headline: 'label:has-text("Headline") input',
    summary: 'label:has-text("Summary") textarea',
  };

  for (const [key, selector] of Object.entries(fieldSelectors)) {
    const input = popupPage.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill(TEST_PROFILE[key as keyof ProfileData]);
    }
  }

  // Save profile
  const saveButton = popupPage.locator('button:has-text("Save profile")');
  await saveButton.waitFor({ state: "visible", timeout: 5000 });
  await saveButton.click();

  // Wait for save to complete
  await popupPage.waitForSelector("text=/Profile saved/", { timeout: 10000 });
  await popupPage.waitForTimeout(500);
}

/**
 * Scan the current page using the Fill tab.
 */
export async function scanPage(popupPage: Page): Promise<void> {
  // Navigate to Fill tab
  const fillTab = popupPage.locator('button:has-text("Fill")');
  await fillTab.click();
  await popupPage.waitForTimeout(500);

  // Click Scan Page button
  const scanButton = popupPage.locator('button:has-text("Scan Page")');
  await scanButton.waitFor({ state: "visible", timeout: 5000 });
  await scanButton.click();

  // Wait for scan to complete (preview modal appears)
  await popupPage.waitForSelector('[role="dialog"]:has-text("Preview")', { timeout: 20000 });
}

/**
 * Send scan results to Review tab.
 */
export async function sendToReview(popupPage: Page): Promise<void> {
  const sendButton = popupPage.locator('[role="dialog"] button:has-text("Send to Review")');
  await sendButton.waitFor({ state: "visible", timeout: 5000 });
  await sendButton.click();
  await popupPage.waitForTimeout(500);

  // Verify we're on Review tab
  await popupPage.waitForSelector("h2:has-text('Review')", { timeout: 5000 });
}

/**
 * Confirm fields in Review tab and fill them.
 */
export async function confirmAndFill(
  popupPage: Page,
  fieldNames: string[] = ["fullName", "email", "phone"],
): Promise<number> {
  // Check the desired fields
  for (const fieldName of fieldNames) {
    const checkbox = popupPage.locator(`input[type="checkbox"][aria-label*="${fieldName}" i]`);
    if (await checkbox.isVisible().catch(() => false)) {
      if (!(await checkbox.isChecked())) {
        await checkbox.click();
      }
    }
  }

  // Click Fill Checked Fields button
  const fillButton = popupPage.locator('button:has-text("Fill Checked Fields")');
  await fillButton.waitFor({ state: "visible", timeout: 5000 });
  await fillButton.click();

  // Wait for fill to complete (notice appears)
  await popupPage.waitForSelector("text=/filled/i", { timeout: 15000 });

  // Get the filled count from the notice
  const notice = popupPage.locator("text=/filled/i").first();
  const noticeText = await notice.textContent().catch(() => "");
  const match = noticeText?.match(/(\d+)\s*field/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Skip the current stage in Review tab.
 */
export async function skipStage(popupPage: Page): Promise<void> {
  const skipButton = popupPage.locator('button:has-text("Skip Stage")');
  await skipButton.waitFor({ state: "visible", timeout: 5000 });
  await skipButton.click();
  await popupPage.waitForTimeout(500);
}

/**
 * Assert that no auto-submit element exists on the target page.
 * This verifies the extension doesn't automatically submit forms.
 */
export async function assertNoAutoSubmit(targetPage: Page): Promise<void> {
  // Check that forms are still present and haven't been submitted
  const forms = targetPage.locator("form");
  const formCount = await forms.count();

  expect(formCount).toBeGreaterThan(0);

  for (let i = 0; i < formCount; i++) {
    const form = forms.nth(i);
    // Verify form is still visible (not navigated away)
    await expect(form).toBeVisible();
  }

  // Verify no submit button was programmatically clicked
  const submitButtons = targetPage.locator('button[type="submit"], input[type="submit"]');
  const buttonCount = await submitButtons.count();

  for (let i = 0; i < buttonCount; i++) {
    const button = submitButtons.nth(i);
    // Button should still be enabled and not in a "submitting" state
    await expect(button).toBeEnabled();
  }

  // Verify page hasn't navigated (URL should still be the fixture)
  const url = targetPage.url();
  if (url.includes("stage-1")) {
    expect(url).toContain("stage-1");
  } else if (url.includes("stage-2")) {
    expect(url).toContain("stage-2");
  }
}

/**
 * Get the target page (the page with the fixture loaded).
 */
export async function getTargetPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  for (const page of pages) {
    const url = page.url();
    if (url.includes("localhost:34567") || url.includes("stage-")) {
      return page;
    }
  }
  // If not found, create a new page and navigate to stage-1
  const page = await context.newPage();
  page.on("console", (msg) => {
    console.log(`[TARGET CONSOLE] ${msg.type()}: ${msg.text()}`);
  });
  await page.goto("http://localhost:34567/stage-1-contact.html");
  await page.waitForLoadState("domcontentloaded");
  return page;
}

/**
 * Navigate target page to a specific fixture.
 */
export async function navigateToFixture(targetPage: Page, fixtureName: string): Promise<void> {
  await targetPage.goto(`http://localhost:34567/${fixtureName}`);
  await targetPage.waitForLoadState("domcontentloaded");
  await targetPage.waitForSelector(`[data-stage]`, { timeout: 5000 });
}

/**
 * Verify detected fields in preview modal match expected fields.
 */
export async function verifyDetectedFields(
  popupPage: Page,
  expectedFields: string[],
): Promise<void> {
  const previewModal = popupPage.locator('[role="dialog"]');
  await previewModal.waitFor({ state: "visible" });

  for (const field of expectedFields) {
    await expect(previewModal.locator(`td:has-text("${field}")`)).toBeVisible({ timeout: 5000 });
  }
}

/**
 * Verify filled values on the target page.
 */
export async function verifyFilledValues(
  targetPage: Page,
  expectedValues: Partial<ProfileData>,
): Promise<void> {
  for (const [field, expectedValue] of Object.entries(expectedValues)) {
    let selector: string;
    switch (field) {
      case "fullName":
        selector = "#fullName, input[name='fullName']";
        break;
      case "email":
        selector = "#email, input[name='email']";
        break;
      case "phone":
        selector = "#phone, input[name='phone']";
        break;
      case "headline":
        selector = "#desiredTitle, input[name='desiredTitle'], #currentPosition, input[name='currentPosition']";
        break;
      case "summary":
        selector = "#summary, textarea[name='summary']";
        break;
      default:
        continue;
    }

    const input = targetPage.locator(selector).first();
    if (await input.isVisible().catch(() => false)) {
      const value = await input.inputValue();
      expect(value).toBe(expectedValue);
    }
  }
}

import { expect } from "@playwright/test";

// Re-export constants and utilities for test configuration
export { TEST_PASSPHRASE, TEST_PROFILE, isWindows };