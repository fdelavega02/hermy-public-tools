import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, "config.json");

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig() {
  if (!(await exists(CONFIG_PATH))) {
    throw new Error("Missing config.json. Copy config.example.json to config.json first.");
  }

  return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
}

function resolveProjectPath(projectRelativePath) {
  return path.resolve(__dirname, projectRelativePath);
}

function parseArgs(argv) {
  const args = {
    postNow: false,
    dryRun: false,
    approved: false,
    headless: false,
    text: null,
    textFile: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--post-now") args.postNow = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--approved") args.approved = true;
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--headful") args.headless = false;
    else if (arg === "--text") args.text = argv[++i] ?? null;
    else if (arg === "--text-file") args.textFile = argv[++i] ?? null;
  }

  return args;
}

async function loadText({ text, textFile }) {
  if (textFile) {
    return (await fs.readFile(path.resolve(process.cwd(), textFile), "utf8")).trim();
  }
  return (text || "").trim();
}

async function clickFirstVisible(page, selectors, timeout) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 3000 });
      await locator.click();
      return selector;
    } catch {
      // try next selector
    }
  }

  throw new Error(`Could not find a visible match for any start-post selector: ${selectors.join(" | ")}`);
}

async function waitForFirstVisible(page, selectors, timeout = 10000) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: Math.min(timeout, 3000) });
      return { selector, locator };
    } catch {
      // try next selector
    }
  }

  throw new Error(`Could not find a visible match for any selector: ${selectors.join(" | ")}`);
}

async function clickFirstVisibleWithin(container, selectors, timeout = 10000) {
  for (const selector of selectors) {
    const locator = container.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: Math.min(timeout, 3000) });
      await locator.click();
      return selector;
    } catch {
      // try next selector
    }
  }

  throw new Error(`Could not find a visible match within container for any selector: ${selectors.join(" | ")}`);
}

async function fillComposer(page, editorSelectors, text) {
  for (const selector of editorSelectors) {
    const editor = page.locator(selector).first();
    try {
      await editor.waitFor({ state: "visible", timeout: 5000 });
      await editor.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.insertText(text);
      return selector;
    } catch {
      // try next selector
    }
  }

  const placeholder = page.getByText("Share your thoughts...", { exact: true }).first();
  try {
    await placeholder.waitFor({ state: "visible", timeout: 5000 });
    await placeholder.click();
    await page.keyboard.insertText(text);
    return "placeholder-text-fallback";
  } catch {
    // fall through
  }

  throw new Error(`Could not find a visible editor for any selector: ${editorSelectors.join(" | ")}`);
}

async function confirmPublish() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type POST to publish this LinkedIn post: ");
  rl.close();
  return answer.trim() === "POST";
}

async function saveScreenshot(page, fileName) {
  await fs.mkdir(path.join(__dirname, "output"), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, "output", fileName), fullPage: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = await loadText(args);

  if (!text) {
    throw new Error("No post text provided. Use --text or --text-file.");
  }

  const config = await loadConfig();
  const statePath = resolveProjectPath(config.statePath || "./state/storage-state.json");
  if (!(await exists(statePath))) {
    throw new Error("Missing saved browser state. Run npm run auth first.");
  }

  const selectors = config.selectors || {};
  const loginUrl = config.loginUrl || "https://www.linkedin.com/feed/";
  const timeout = config.defaultTimeoutMs || 45000;
  const startPostSelectors = [
    selectors.startPostButton,
    "button:has-text('Start a post')",
    "button[aria-label*='Start a post']",
    "button.share-box-feed-entry__trigger",
    "div.share-box-feed-entry button",
    "div[role='button']:has-text('Start a post')",
    "div[aria-label='Start a post']",
    "p:has-text('Start a post')"
  ].filter(Boolean);
  const composerSelectors = [
    selectors.composerDialog,
    "div[data-test-modal][role='dialog']",
    "div[role='dialog'].share-box-v2__modal",
    "div[role='dialog'][aria-labelledby='share-to-linkedin-modal__header']"
  ].filter(Boolean);
  const editorSelectors = [
    selectors.editor,
    "div[data-test-modal][role='dialog'] div[role='textbox']",
    "div[data-test-modal][role='dialog'] [contenteditable='true']",
    "div[role='dialog'].share-box-v2__modal div[role='textbox']",
    "div[role='dialog'].share-box-v2__modal [contenteditable='true']",
    "div[role='textbox'][contenteditable='true']",
    ".ql-editor[contenteditable='true']",
    "[contenteditable='true'][aria-multiline='true']"
  ].filter(Boolean);
  const postButtonSelectors = [
    "button.artdeco-button--primary",
    "button.share-actions__primary-action",
    "button[aria-label*='Post']",
    "button:has-text('Post')",
    ".artdeco-button--primary:has-text('Post')"
  ].filter(Boolean);

  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  if (selectors.postLoginReady) {
    await page.waitForSelector(selectors.postLoginReady, { timeout });
  }

  const clickedSelector = await clickFirstVisible(page, startPostSelectors, timeout);
  console.log(`Clicked start-post control: ${clickedSelector}`);

  let composerDialog;
  try {
    ({ locator: composerDialog } = await waitForFirstVisible(page, composerSelectors, 10000));
  } catch {
    await saveScreenshot(page, "compose-open-failed.png");
    throw new Error("LinkedIn feed opened, but the composer dialog did not appear. Saved screenshot to output/compose-open-failed.png");
  }

  const editorSelectorUsed = await fillComposer(page, editorSelectors, text);
  console.log(`Inserted draft into LinkedIn composer using: ${editorSelectorUsed}`);

  if (args.dryRun || !args.postNow) {
    console.log("Dry run only. Composer is open; no post was published.");
    await saveScreenshot(page, "compose-preview.png");
    await browser.close();
    return;
  }

  const ok = args.approved ? true : await confirmPublish();
  if (!ok) {
    console.log("Publish cancelled.");
    await browser.close();
    return;
  }

  const configuredPostSelectors = String(selectors.postButton || "")
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean)
    .map((selector) => selector.replace(/^div\[role='dialog'\]\s+/, ""));

  const publishSelectors = [...configuredPostSelectors, ...postButtonSelectors];
  let postSelectorUsed;
  try {
    postSelectorUsed = await clickFirstVisibleWithin(composerDialog, publishSelectors, timeout);
    console.log(`Clicked publish control using: ${postSelectorUsed}`);
  } catch (error) {
    try {
      postSelectorUsed = await clickFirstVisible(page, publishSelectors, timeout);
      console.log(`Clicked publish control using page-wide fallback: ${postSelectorUsed}`);
    } catch {
      await saveScreenshot(page, "post-button-not-found.png");
      throw error;
    }
  }

  try {
    await composerDialog.waitFor({ state: "hidden", timeout: 30000 });
  } catch {
    await saveScreenshot(page, "post-submit-stuck.png");
    console.warn("Composer did not disappear after clicking Post. Check the browser window.");
  }

  await saveScreenshot(page, "post-submitted.png");

  console.log("LinkedIn post submitted.");
  await browser.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
