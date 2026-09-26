// e2e/extension-load.spec.ts
import { test, expect, skip } from "@playwright/test";
import { startFixtureServer, stopFixtureServer, type FixtureServer } from "./utils/fixture-server";
import { launchWithExtension } from "./utils/extension-helpers";
import { isWindows } from "./utils/extension-helpers"; // We'll add this export

let fixtureServer: FixtureServer;

test.beforeAll(async () => {
  fixtureServer = await startFixtureServer();
  console.log(`Fixture server started at ${fixtureServer.url}`);
});

test.afterAll(async () => {
  await stopFixtureServer();
  console.log("Fixture server stopped");
});

/**
 * Test that verifies the extension can be loaded.
 * On Windows with Playwright's bundled Chromium, this will fail with a clear message.
 * On Linux/macOS or with system Chrome/Edge, this should pass.
 */
test.describe("Extension Loading", () => {
  test("extension loads successfully", async () => {
    // Skip on Windows since Playwright's Chromium doesn't support --load-extension
    // Even with system Chrome, Playwright's launch mechanism interferes
    if (isWindows()) {
      test.skip(true, "Extension loading not supported on Windows with Playwright. " +
        "Use Linux/macOS or a dedicated CI environment with Chrome for Testing + extension support.");
    }
    
    const context = await launchWithExtension();
    
    expect(context.extensionId).toBeTruthy();
    expect(context.popupPage).toBeTruthy();
    expect(context.context).toBeTruthy();
    
    // Verify popup loads
    await expect(context.popupPage.locator("h1:has-text('RBG Candidate')")).toBeVisible();
    
    await context.context.close();
  });

  test("extension popup shows Settings tab by default", async () => {
    if (isWindows()) {
      test.skip(true, "Extension loading not supported on Windows with Playwright.");
    }
    
    const context = await launchWithExtension();
    
    // Settings tab should be active by default
    const settingsTab = context.popupPage.locator('button:has-text("Settings")');
    await expect(settingsTab).toHaveAttribute("aria-pressed", "true");
    
    // Fill tab should exist but not be active
    const fillTab = context.popupPage.locator('button:has-text("Fill")');
    await expect(fillTab).toHaveAttribute("aria-pressed", "false");
    
    await context.context.close();
  });
});

/**
 * Test that demonstrates the fixture server works independently of the extension.
 * This can run even when the extension fails to load.
 */
test.describe("Fixture Server (no extension required)", () => {
  test("stage-1 fixture loads and has expected form fields", async ({ page }) => {
    await page.goto("http://localhost:34567/stage-1-contact.html");
    await page.waitForLoadState("domcontentloaded");
    
    // Verify stage indicator
    await expect(page.locator('[data-stage="1"]')).toBeVisible();
    
    // Verify form fields exist
    await expect(page.locator("#fullName")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#phone")).toBeVisible();
    await expect(page.locator("#mobile")).toBeVisible();
    await expect(page.locator("#emailConfirm")).toBeVisible();
    await expect(page.locator("#firstName")).toBeVisible();
    await expect(page.locator("#lastName")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    
    // Verify submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("stage-2 fixture loads and has expected form fields", async ({ page }) => {
    await page.goto("http://localhost:34567/stage-2-experience.html");
    await page.waitForLoadState("domcontentloaded");
    
    // Verify stage indicator
    await expect(page.locator('[data-stage="2"]')).toBeVisible();
    
    // Verify form fields exist
    await expect(page.locator("#desiredTitle")).toBeVisible();
    await expect(page.locator("#headlineAria")).toBeVisible();
    await expect(page.locator("#wrappingHeadline")).toBeVisible();
    await expect(page.locator("#currentPosition")).toBeVisible();
    await expect(page.locator("#summary")).toBeVisible();
    await expect(page.locator("#coverLetter")).toBeVisible();
    await expect(page.locator("#aboutYou")).toBeVisible();
    await expect(page.locator("#experienceLevel")).toBeVisible();
    await expect(page.locator("#objective")).toBeVisible();
    await expect(page.locator("#description")).toBeVisible();
    await expect(page.locator("#confirmPassword")).toBeVisible();
    
    // Verify submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

/**
 * Test that verifies no auto-submit behavior on fixture pages.
 * This tests the fixture pages directly without the extension.
 */
test.describe("No Auto-Submit Assertion (fixture pages)", () => {
  test("stage-1 form does not auto-submit", async ({ page }) => {
    await page.goto("http://localhost:34567/stage-1-contact.html");
    await page.waitForLoadState("domcontentloaded");
    
    // Fill some fields
    await page.fill("#fullName", "John Doe");
    await page.fill("#email", "john.doe@example.com");
    await page.fill("#phone", "(555) 123-4567");
    
    // Wait a moment to ensure no auto-submit
    await page.waitForTimeout(1000);
    
    // Verify form is still present (not submitted/navigated)
    await expect(page.locator("#contact-form")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    
    // Verify URL hasn't changed
    expect(page.url()).toContain("stage-1-contact.html");
  });

  test("stage-2 form does not auto-submit", async ({ page }) => {
    await page.goto("http://localhost:34567/stage-2-experience.html");
    await page.waitForLoadState("domcontentloaded");
    
    // Fill some fields
    await page.fill("#desiredTitle", "Senior Software Engineer");
    await page.fill("#summary", "Experienced software engineer with 10+ years of experience.");
    
    // Wait a moment to ensure no auto-submit
    await page.waitForTimeout(1000);
    
    // Verify form is still present (not submitted/navigated)
    await expect(page.locator("#experience-form")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    
    // Verify URL hasn't changed
    expect(page.url()).toContain("stage-2-experience.html");
  });
});