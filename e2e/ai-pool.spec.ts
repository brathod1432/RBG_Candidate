// e2e/ai-pool.spec.ts
//
// Full-stack E2E: real Chromium + unpacked extension + FastAPI server + AI
// worker pool. Point the server at scripts/fake_nvidia_server.py for an
// offline run, or at the real NVIDIA API for a live run.
//
//   1. python scripts/fake_nvidia_server.py --port 9100          (offline only)
//   2. NVIDIA_BASE_URL=http://127.0.0.1:9100/v1 uvicorn server.main:app --port 8000
//   3. python -m http.server 34567 --directory tests/fixtures
//   4. cd client && npm run build
//   5. cd e2e && CHROME_PATH=/path/to/chrome npx playwright test ai-pool.spec.ts
//
// Windows: set CHROME_PATH to Chrome/Edge (Playwright's bundled Chromium
// cannot load unpacked extensions there).
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(here, "../client/dist");
const SERVER = process.env.RBG_SERVER ?? "http://127.0.0.1:8000";
const FIXTURES = process.env.FIXTURE_URL ?? "http://localhost:34567";
const SHOTS = process.env.SHOT_DIR ?? path.resolve(here, "../test-results/ai-pool");

const PROFILE = {
  "Full name": "Ada Lovelace",
  Email: "ada@example.com",
  Phone: "+44 20 7946 0000",
  Headline: "Senior Software Engineer",
  Summary: "Ten years building Python services, async APIs and data pipelines.",
};

let context: BrowserContext;
let extensionId: string;

async function launch(): Promise<void> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "rbg-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 1100, height: 900 },
  });
  let [sw] = context.serviceWorkers();
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  }
  extensionId = new URL(sw.url()).host;
}

async function openPopup(): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("h1")).toHaveText("RBG Candidate");
  return popup;
}

async function saveProfile(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: "Profile", exact: true }).click().catch(() => undefined);
  for (const [label, value] of Object.entries(PROFILE)) {
    const field = popup.getByLabel(label, { exact: true });
    await field.fill(value);
  }
  await popup.getByRole("button", { name: "Save profile" }).click();
  await expect(popup.getByText("Profile saved on this device.")).toBeVisible();
}

/** Scan with the target tab active (popup opened as a tab can't be the active tab). */
async function scanTarget(popup: Page, target: Page): Promise<void> {
  await popup.getByRole("button", { name: "Scan", exact: true }).click();
  await target.bringToFront();
  await popup.getByRole("button", { name: /^Scan (this page|again)$/ }).click();
  const status = popup.getByTestId("ai-status");
  await expect(status).toHaveAttribute("data-status", /done|offline/, { timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch(`${SERVER}/health`).then((r) => r.ok).catch(() => false);
  test.skip(!health, `RBG server not running at ${SERVER}`);
  await launch();
});

test.afterAll(async () => {
  await context?.close();
});

test("popup → coordinator → 15 workers → review → fill (stage 2 fixture)", async () => {
  const popup = await openPopup();
  await saveProfile(popup);

  const target = await context.newPage();
  await target.goto(`${FIXTURES}/stage-2-experience.html`);
  const urlBefore = target.url();

  await scanTarget(popup, target);
  await expect(popup.getByTestId("ai-status")).toHaveAttribute("data-status", "done");
  await expect(popup.getByTestId("ai-status")).toContainText("worker");
  await popup.screenshot({ path: `${SHOTS}/1-preview.png`, fullPage: true });

  await expect(popup.getByRole("region", { name: "Scan results" })).toContainText("workers");
  await popup.getByRole("button", { name: /^Review \d+ values?$/ }).click();
  await expect(popup.getByRole("heading", { name: /Review — stage 2/ })).toBeVisible();
  // Each value shows where it came from.
  await expect(popup.locator('[data-source="ai"]').first()).toBeVisible();
  await expect(popup.locator('[data-source="profile"]').first()).toBeVisible();

  // Profile value straight from Settings, AI values from the pool.
  await expect(popup.getByLabel("Value for summary")).toHaveValue(PROFILE.Summary);
  await expect(popup.getByLabel("Value for coverLetter")).not.toHaveValue("");
  await expect(popup.getByLabel("Value for experienceLevel")).not.toHaveValue("");

  // User edits one AI answer before filling.
  await popup.getByLabel("Value for aboutYou").fill("Edited by me before filling.");
  await popup.screenshot({ path: `${SHOTS}/2-review.png`, fullPage: true });

  await target.bringToFront();
  await popup.getByRole("button", { name: /^Fill \d+ fields?$/ }).click();
  await expect(popup.getByText(/Stage 2 filled with \d+ confirmed field/)).toBeVisible({ timeout: 90_000 });

  await expect(target.locator("#summary")).toHaveValue(PROFILE.Summary);
  await expect(target.locator("#aboutYou")).toHaveValue("Edited by me before filling.");
  await expect(target.locator("#coverLetter")).not.toHaveValue("");
  await expect(target.locator("#experienceLevel")).not.toHaveValue("");
  await expect(target.locator("#confirmPassword")).toHaveValue(""); // never touched
  expect(target.url()).toBe(urlBefore); // never submitted
  await target.screenshot({ path: `${SHOTS}/3-filled-page.png`, fullPage: true });
  await popup.close();
});

test("React-style controlled inputs register the fill; selects, numbers, unlabeled fields", async () => {
  const popup = await openPopup();
  const target = await context.newPage();
  await target.goto(`${FIXTURES}/react-controlled.html`);

  await scanTarget(popup, target);
  await popup.getByRole("button", { name: /^Review \d+ values?$/ }).click();

  await expect(popup.getByLabel("Value for firstName")).toHaveValue("Ada");
  await expect(popup.getByLabel("Value for lastName")).toHaveValue("Lovelace");
  await expect(popup.getByLabel("Value for pyYears")).toHaveValue(/^\d+$/);
  await expect(popup.getByLabel("Value for why")).not.toHaveValue("");

  await target.bringToFront();
  await popup.getByRole("button", { name: /^Fill \d+ fields?$/ }).click();
  await expect(popup.getByText(/filled with \d+ confirmed field/)).toBeVisible({ timeout: 90_000 });

  const state = JSON.parse((await target.locator("#state").textContent()) ?? "{}") as Record<string, string>;
  expect(state["firstName"]).toBe("Ada");
  expect(state["lastName"]).toBe("Lovelace");
  expect(state["email"]).toBe("ada@example.com");
  expect(state["why"]?.length ?? 0).toBeGreaterThan(0);
  expect(state["why"]?.length ?? 0).toBeLessThanOrEqual(600);
  expect(await target.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted)).toBeFalsy();
  await target.screenshot({ path: `${SHOTS}/4-react-filled.png`, fullPage: true });
  await popup.close();
});

test("typing agents: 3 named cursors type letter by letter, in parallel", async () => {
  const popup = await openPopup();
  // Settings (default tab) → Typing agents: 3 agents, normal speed.
  await popup.getByLabel("Number of typing agents").fill("3");
  await popup.getByRole("group", { name: "Typing speed" }).getByRole("button", { name: "Normal" }).click();
  await expect(popup.locator("[data-agent-chip]")).toHaveCount(3);

  const target = await context.newPage();
  await target.goto(`${FIXTURES}/react-controlled.html`);
  await scanTarget(popup, target);
  await popup.getByRole("button", { name: /^Review \d+ values?$/ }).click();
  const whyFinal = await popup.getByLabel("Value for why").inputValue();
  expect(whyFinal.length).toBeGreaterThan(20);

  // Sample the page while the agents work (main world can read the open shadow root).
  await target.evaluate(() => {
    const w = window as unknown as { __rbg: { names: string[]; maxTyping: number; whyLens: number[] } };
    w.__rbg = { names: [], maxTyping: 0, whyLens: [] };
    const tick = (): void => {
      const host = document.getElementById("rbg-agents-overlay");
      const root = host?.shadowRoot;
      if (root) {
        const cursors = Array.from(root.querySelectorAll("[data-agent]"));
        for (const c of cursors) {
          const n = c.getAttribute("data-agent") ?? "";
          if (!w.__rbg.names.includes(n)) w.__rbg.names.push(n);
        }
        const typing = cursors.filter((c) => c.getAttribute("data-state") === "typing").length;
        w.__rbg.maxTyping = Math.max(w.__rbg.maxTyping, typing);
      }
      const len = (document.getElementById("why") as HTMLTextAreaElement).value.length;
      if (w.__rbg.whyLens[w.__rbg.whyLens.length - 1] !== len) w.__rbg.whyLens.push(len);
      setTimeout(tick, 15);
    };
    tick();
  });

  await target.bringToFront();
  await popup.getByRole("button", { name: /^Fill \d+ fields?$/ }).click();
  const overlay = target.locator("#rbg-agents-overlay");
  await expect(overlay).toBeAttached({ timeout: 10_000 });
  await target.waitForTimeout(700);
  await target.screenshot({ path: `${SHOTS}/5-agents-typing.png` });

  await expect(popup.getByText(/filled with \d+ confirmed field.*\(Nova \d+, Echo \d+, Blaze \d+\)/)).toBeVisible({ timeout: 90_000 });

  const stats = await target.evaluate(
    () => (window as unknown as { __rbg: { names: string[]; maxTyping: number; whyLens: number[] } }).__rbg,
  );
  expect(stats.names.sort()).toEqual(["Blaze", "Echo", "Nova"]);
  expect(stats.maxTyping).toBeGreaterThanOrEqual(2); // agents type in parallel
  const partial = stats.whyLens.filter((n) => n > 0 && n < whyFinal.length);
  expect(partial.length).toBeGreaterThan(5); // typed progressively, not pasted

  await expect(target.locator("#why")).toHaveValue(whyFinal);
  const state = JSON.parse((await target.locator("#state").textContent()) ?? "{}") as Record<string, string>;
  expect(state["why"]).toBe(whyFinal); // React-style app saw every keystroke
  expect(state["firstName"]).toBe("Ada");
  expect(await target.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted)).toBeFalsy();
  await expect(overlay).toHaveCount(0, { timeout: 10_000 }); // overlay cleans itself up
  await popup.close();
});

test("typing agents: Esc finishes instantly", async () => {
  const popup = await openPopup();
  await popup.getByRole("group", { name: "Typing speed" }).getByRole("button", { name: "Slow" }).click();
  const target = await context.newPage();
  await target.goto(`${FIXTURES}/stage-2-experience.html`);
  await scanTarget(popup, target);
  await popup.getByRole("button", { name: /^Review \d+ values?$/ }).click();
  const cover = await popup.getByLabel("Value for coverLetter").inputValue();
  await target.bringToFront();
  await popup.getByRole("button", { name: /^Fill \d+ fields?$/ }).click();
  await expect(target.locator("#rbg-agents-overlay")).toBeAttached({ timeout: 10_000 });
  await target.waitForTimeout(600);
  const t0 = Date.now();
  await target.keyboard.press("Escape");
  await expect(popup.getByText(/filled with \d+ confirmed field/)).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(8_000);
  await expect(target.locator("#coverLetter")).toHaveValue(cover);
  await popup.getByRole("button", { name: "Profile", exact: true }).click();
  await popup.getByRole("group", { name: "Typing speed" }).getByRole("button", { name: "Normal" }).click();
  await popup.close();
});

test("Markdown CV: download template, import, auto-fill a full application", async () => {
  const popup = await openPopup();
  await popup.screenshot({ path: `${SHOTS}/6-popup-profile.png`, fullPage: true });

  // Template download works from the popup.
  const [download] = await Promise.all([
    popup.waitForEvent("download"),
    popup.getByRole("button", { name: /Download template/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("rbg-candidate-profile.md");

  // Import the filled CV.
  await popup.getByLabel("Import profile Markdown file").setInputFiles(path.resolve(here, "../tests/fixtures/sample-profile.md"));
  await expect(popup.getByText(/Imported sample-profile.md/)).toBeVisible();
  const summary = popup.getByTestId("import-summary");
  await expect(summary).toContainText("2 jobs");
  await expect(summary).toContainText("yrs experience");
  await expect(summary).toContainText("6 skills");
  await expect(popup.getByRole("heading", { name: "Ada King Lovelace" })).toBeVisible();
  await popup.getByText("Edit basics").click().catch(() => undefined);
  await expect(popup.getByLabel("Full name", { exact: true })).toHaveValue("Ada King Lovelace");
  await expect(popup.getByLabel("Headline", { exact: true })).toHaveValue("Senior Software Engineer — Python & AI");
  await expect(popup.getByLabel("Resume / extra details (used by AI workers)")).toHaveValue(/Total professional experience: \d+(\.\d)? years/);
  await popup.screenshot({ path: `${SHOTS}/7-popup-imported.png`, fullPage: true });

  const target = await context.newPage();
  await target.goto(`${FIXTURES}/full-application.html`);
  await scanTarget(popup, target);
  await expect(popup.getByRole("button", { name: "Scan again" })).toBeEnabled();
  await popup.waitForTimeout(300); // let the button's fade-in finish before the screenshot
  await popup.screenshot({ path: `${SHOTS}/8-popup-scan.png`, fullPage: true });
  await popup.getByRole("button", { name: /^Review \d+ values?$/ }).click();
  await expect(popup.getByLabel("Value for first")).toHaveValue("Ada");
  await expect(popup.getByLabel("Value for middle")).toHaveValue("King");
  await expect(popup.getByLabel("Value for last")).toHaveValue("Lovelace");
  await expect(popup.getByLabel("Value for city")).toHaveValue("London");
  await expect(popup.getByLabel("Value for li")).toHaveValue("https://www.linkedin.com/in/ada-lovelace");
  await expect(popup.getByLabel("Value for gh")).toHaveValue("https://github.com/ada");
  await expect(popup.getByLabel("Value for yrs")).toHaveValue("10");
  await expect(popup.getByLabel("Value for notice")).toHaveValue("1 month");
  await expect(popup.getByLabel("Value for cur")).toHaveValue("Senior Software Engineer — Python & AI");
  // Skills are ranked against the job ("Staff Python Engineer ... React front ends") and fitted to limits.
  await expect(popup.getByLabel("Value for sk1")).toHaveValue("Python");
  await expect(popup.getByLabel("Value for sk2")).toHaveValue("React");
  await expect(popup.getByLabel("Value for keys")).toHaveValue("Python, React, SQL");
  await popup.screenshot({ path: `${SHOTS}/9-popup-review.png` });
  await popup.emulateMedia({ colorScheme: "dark" });
  await popup.waitForTimeout(400); // let colour transitions settle
  await popup.screenshot({ path: `${SHOTS}/9b-popup-review-dark.png` });
  await popup.emulateMedia({ colorScheme: "light" });

  await target.bringToFront();
  await popup.getByRole("button", { name: /^Fill \d+ fields?$/ }).click();
  await expect(target.locator("#rbg-agents-overlay")).toBeAttached({ timeout: 10_000 });
  await target.waitForTimeout(900);
  await target.screenshot({ path: `${SHOTS}/10-agents-full-form.png` });
  await target.waitForTimeout(2200);
  await target.screenshot({ path: `${SHOTS}/11-agents-later.png` });
  await expect(popup.getByText(/filled with \d+ confirmed field/)).toBeVisible({ timeout: 90_000 });
  await expect(target.locator("#middle")).toHaveValue("King");
  await expect(target.locator("#li")).toHaveValue("https://www.linkedin.com/in/ada-lovelace");
  await expect(target.locator("#yrs")).toHaveValue("10");
  expect(await target.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted)).toBeFalsy();
  await popup.close();
});

test("Prepare step: health checks go green and lead to Scan", async () => {
  const popup = await openPopup();
  await popup.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Prepare/ }).click();
  await expect(popup.getByTestId("overall-status")).toHaveText("Ready", { timeout: 15_000 });
  const checks = popup.getByRole("list", { name: "Health checks" });
  await expect(checks.getByRole("listitem", { name: "Server reachable: online" })).toBeVisible();
  await expect(checks.getByRole("listitem", { name: "NVIDIA API key: configured" })).toBeVisible();
  await expect(checks.getByRole("listitem", { name: "AI workers: 15/15" })).toBeVisible();
  await expect(popup.getByTestId("server-pill")).toHaveText("15/15 workers");
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: `${SHOTS}/12-popup-prepare.png`, fullPage: true });
  await popup.getByTestId("continue-to-fill").click();
  await expect(popup.getByRole("button", { name: /Scan (this page|again)/ })).toBeVisible();
  await popup.close();
});

test("API key: no passphrase — save, used by Prepare, remove", async () => {
  const popup = await openPopup();
  const section = popup.getByRole("region", { name: "NVIDIA API key" });
  if (!(await section.getByPlaceholder("nvapi-…").isVisible())) await section.locator("summary").click();
  await expect(popup.getByLabel(/passphrase/i)).toHaveCount(0);
  await section.getByPlaceholder("nvapi-…").fill("nvapi-e2e-test-key-1234");
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(popup.getByText("API key saved (encrypted on this device).")).toBeVisible();
  await expect(section.getByTestId("key-status")).toHaveText("your key");
  await expect(section.getByText("nvapi-…1234")).toBeVisible();
  await expect(popup.getByTestId("key-pill")).toHaveText("your key", { timeout: 15_000 });

  // Stored encrypted, not as plain text.
  const dump = await popup.evaluate(
    () => new Promise<string>((r) => chrome.storage.local.get(null, (i) => r(JSON.stringify(i)))),
  );
  expect(dump).not.toContain("e2e-test-key");
  expect(dump).toContain("rbg_api_key_enc");

  await popup.waitForTimeout(300);
  await popup.screenshot({ path: `${SHOTS}/13-popup-api-key.png`, fullPage: true });

  await section.getByRole("button", { name: "Remove" }).click();
  await expect(section.getByTestId("key-status")).toHaveText("using .env key");
  await expect(popup.getByTestId("key-pill")).toHaveText(".env key", { timeout: 15_000 });
  await popup.close();
});

test("server offline: clear message instead of 'Failed to fetch'", async () => {
  // Point the extension at a port where nothing listens by stopping nothing:
  // ask the background directly with an unused base URL.
  const popup = await openPopup();
  const reason = await popup.evaluate(
    () =>
      new Promise<string>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "AI_SUGGEST", descriptors: [{ id: "q", selector: "#q", label: "Why?", type: "text", placeholder: "", options: [], required: false }], serverBaseUrl: "http://127.0.0.1:8599" },
          (r: { reason?: string }) => resolve(r?.reason ?? ""),
        ),
      ),
  );
  expect(reason).toContain("local AI server isn't running");
  expect(reason).toContain("start-server.bat");
  await popup.close();
});
