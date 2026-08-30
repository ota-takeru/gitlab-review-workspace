import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const defaultBaseUrl = "http://127.0.0.1:6006";
const defaultOutput = "output/playwright/ui-review";

function printHelp() {
  console.log(`Usage: npm run ui:capture -- [options]

Options:
  --base-url <url>  Reuse a Storybook server (default: ${defaultBaseUrl})
  --output <path>   PNG, manifest, and review-board directory (default: ${defaultOutput})
  --case <id>       Capture one case; repeat or comma-separate for several cases
  --help            Show this help

When the local base URL is unavailable, the command starts and later stops Storybook.`);
}

function parseArguments(argv) {
  const options = {
    baseUrl: defaultBaseUrl,
    output: defaultOutput,
    caseIds: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--base-url" || argument === "--output" || argument === "--case") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--base-url") options.baseUrl = value;
      if (argument === "--output") options.output = value;
      if (argument === "--case") options.caseIds.push(...value.split(",").filter(Boolean));
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!(["http:", "https:"].includes(url.protocol))) throw new Error("--base-url must use http or https.");
  if (url.username || url.password) throw new Error("Do not include credentials in --base-url.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

async function isAvailable(url) {
  try {
    const indexUrl = new URL("index.json", url);
    const response = await fetch(indexUrl, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return false;
    const index = await response.json();
    return Boolean(index && typeof index.entries === "object");
  } catch {
    return false;
  }
}

function startStorybook(baseUrl) {
  if (!(baseUrl.hostname === "127.0.0.1" || baseUrl.hostname === "localhost")) {
    throw new Error(`Cannot start a remote Storybook host: ${baseUrl.hostname}`);
  }

  const port = baseUrl.port || (baseUrl.protocol === "https:" ? "443" : "80");
  const storybookBin = resolve(repositoryRoot, "node_modules/storybook/dist/bin/dispatcher.js");
  const child = spawn(process.execPath, [storybookBin, "dev", "-p", port, "--host", "127.0.0.1", "--no-open"], {
    cwd: repositoryRoot,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let outputTail = "";
  const appendOutput = (chunk) => {
    outputTail = `${outputTail}${chunk.toString()}`.slice(-8_000);
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.outputTail = () => outputTail;
  return child;
}

async function waitForStorybook(baseUrl, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Storybook exited before it became available.\n${child.outputTail()}`);
    }
    if (await isAvailable(baseUrl)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Storybook did not become available within 60 seconds.\n${child.outputTail()}`);
}

async function stopStorybook(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  const exited = new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once("exit", resolveExit);
  });
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([
    exited,
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000))
  ]);
}

function validateCases(rawCases) {
  if (!Array.isArray(rawCases) || rawCases.length === 0) throw new Error("tests/ui/cases.json must contain a non-empty array.");
  const ids = new Set();
  for (const captureCase of rawCases) {
    if (!captureCase || typeof captureCase !== "object") throw new Error("Every capture case must be an object.");
    if (typeof captureCase.id !== "string" || !/^[a-z0-9-]+$/.test(captureCase.id)) throw new Error("Capture case IDs must use lowercase letters, digits, and hyphens.");
    if (ids.has(captureCase.id)) throw new Error(`Duplicate capture case ID: ${captureCase.id}`);
    ids.add(captureCase.id);
    if (typeof captureCase.surface !== "string" || !/^[a-z0-9-]+$/.test(captureCase.surface)) throw new Error(`Invalid surface for ${captureCase.id}.`);
    if (typeof captureCase.state !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(captureCase.state)) throw new Error(`Invalid state for ${captureCase.id}.`);
    if (typeof captureCase.designFocus !== "string" || captureCase.designFocus.trim().length === 0 || captureCase.designFocus.length > 160 || /[\r\n]/.test(captureCase.designFocus)) {
      throw new Error(`designFocus for ${captureCase.id} must be a single concise line of at most 160 characters.`);
    }
    if (typeof captureCase.storyId !== "string" || !/^[a-z0-9-]+--[a-z0-9-]+$/.test(captureCase.storyId)) throw new Error(`Invalid Storybook ID for ${captureCase.id}.`);
    if (!(captureCase.theme === "light" || captureCase.theme === "dark")) throw new Error(`Invalid theme for ${captureCase.id}.`);
    if (!Number.isInteger(captureCase.viewport?.width) || !Number.isInteger(captureCase.viewport?.height)) throw new Error(`Invalid viewport for ${captureCase.id}.`);
    if (captureCase.captureMode !== undefined && !(captureCase.captureMode === "full-page" || captureCase.captureMode === "viewport")) {
      throw new Error(`captureMode for ${captureCase.id} must be full-page or viewport.`);
    }
    validateEvidenceMetadata(captureCase);
  }
  return rawCases;
}

function validateEvidenceMetadata(captureCase) {
  const id = captureCase.id;
  if (captureCase.evidenceLane !== undefined && typeof captureCase.evidenceLane !== "string") {
    throw new Error(`evidenceLane for ${id} must be a string.`);
  }
  if (captureCase.evidenceLanes !== undefined && !Array.isArray(captureCase.evidenceLanes)) {
    throw new Error(`evidenceLanes for ${id} must be an array.`);
  }
  if (captureCase.pairId !== undefined && typeof captureCase.pairId !== "string") {
    throw new Error(`pairId for ${id} must be a string.`);
  }
  if (captureCase.metadata !== undefined && (!captureCase.metadata || typeof captureCase.metadata !== "object" || Array.isArray(captureCase.metadata))) {
    throw new Error(`metadata for ${id} must be an object.`);
  }
  if (captureCase.stateVector === undefined) return;
  const vector = captureCase.stateVector;
  if (!vector || typeof vector !== "object" || Array.isArray(vector)) throw new Error(`stateVector for ${id} must be an object.`);
  if (vector.contentVolume !== undefined && !["low", "medium", "high"].includes(vector.contentVolume)) {
    throw new Error(`stateVector.contentVolume for ${id} must be low, medium, or high.`);
  }
  if (vector.disclosure !== undefined && !["collapsed", "expanded", "mixed"].includes(vector.disclosure)) {
    throw new Error(`stateVector.disclosure for ${id} must be collapsed, expanded, or mixed.`);
  }
  if (vector.warningsErrors !== undefined && !Array.isArray(vector.warningsErrors) && typeof vector.warningsErrors !== "string" && typeof vector.warningsErrors !== "boolean") {
    throw new Error(`stateVector.warningsErrors for ${id} must be an array, string, or boolean.`);
  }
  if (vector.activeStates !== undefined && !Array.isArray(vector.activeStates) && typeof vector.activeStates !== "string") {
    throw new Error(`stateVector.activeStates for ${id} must be an array or string.`);
  }
}

function escapeHtml(value) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (character) => replacements[character]);
}

function surfaceLabel(surface) {
  const labels = {
    "sidebar-review": "Sidebar review",
    "review-file": "Review file panel",
    "commit-diff": "Commit diff panel"
  };
  return labels[surface] ?? surface.replaceAll("-", " ");
}

function groupCasesBySurface(cases) {
  const groups = new Map();
  for (const captureCase of cases) {
    if (!groups.has(captureCase.surface)) groups.set(captureCase.surface, []);
    groups.get(captureCase.surface).push(captureCase);
  }
  return groups;
}

function pairCases(cases) {
  const pairs = new Map();
  for (const captureCase of cases) {
    const key = `${captureCase.storyId}\u0000${captureCase.state}\u0000${captureCase.viewport.width}x${captureCase.viewport.height}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(captureCase);
  }
  const themeOrder = { light: 0, dark: 1 };
  return [...pairs.values()].map((pair) => [...pair].sort((left, right) => themeOrder[left.theme] - themeOrder[right.theme]));
}

function imageAlt(captureCase) {
  return `${surfaceLabel(captureCase.surface)}, ${captureCase.state}, ${captureCase.theme} theme, ${captureCase.viewport.width} by ${captureCase.viewport.height}. Design focus: ${captureCase.designFocus}`;
}

function renderThumbnail(captureCase) {
  return `
    <a class="thumbnail" href="#case-${escapeHtml(captureCase.id)}">
      <img src="${escapeHtml(captureCase.file)}" alt="${escapeHtml(imageAlt(captureCase))}">
      <span><strong>${escapeHtml(captureCase.theme)}</strong> · ${escapeHtml(captureCase.state)}</span>
    </a>`;
}

function renderReviewCard(captureCase) {
  return `
    <article class="review-card" id="case-${escapeHtml(captureCase.id)}">
      <header class="review-card-header">
        <h4>${escapeHtml(captureCase.theme)} theme</h4>
        <code>${escapeHtml(captureCase.id)}</code>
      </header>
      <a class="review-image" href="${escapeHtml(captureCase.file)}" aria-label="Open full-size screenshot: ${escapeHtml(imageAlt(captureCase))}">
        <img src="${escapeHtml(captureCase.file)}" alt="${escapeHtml(imageAlt(captureCase))}">
      </a>
      <dl class="review-card-details">
        <div><dt>State</dt><dd>${escapeHtml(captureCase.state)}</dd></div>
        <div><dt>Viewport</dt><dd>${captureCase.viewport.width}x${captureCase.viewport.height}</dd></div>
        <div><dt>Capture</dt><dd>${escapeHtml(captureCase.captureMode ?? "full-page")}; image extent ${captureCase.imageExtent ? `${captureCase.imageExtent.width}x${captureCase.imageExtent.height}` : "not recorded"}</dd></div>
        <div><dt>Story ID</dt><dd><code>${escapeHtml(captureCase.storyId)}</code></dd></div>
        <div><dt>Design focus</dt><dd>${escapeHtml(captureCase.designFocus)}</dd></div>
      </dl>
    </article>`;
}

function createReviewBoard(cases) {
  const groups = groupCasesBySurface(cases);
  const overview = [...groups.entries()].map(([surface, surfaceCases]) => `
      <section class="overview-group" aria-labelledby="overview-${escapeHtml(surface)}">
        <h3 id="overview-${escapeHtml(surface)}">${escapeHtml(surfaceLabel(surface))}</h3>
        <div class="thumbnail-grid">${pairCases(surfaceCases).flat().map(renderThumbnail).join("")}
        </div>
      </section>`).join("");

  const comparisons = [...groups.entries()].map(([surface, surfaceCases]) => `
      <section class="surface-section" aria-labelledby="surface-${escapeHtml(surface)}">
        <h2 id="surface-${escapeHtml(surface)}">${escapeHtml(surfaceLabel(surface))}</h2>
        <div class="comparison-list">${pairCases(surfaceCases).map((pair) => {
          const exemplar = pair[0];
          return `
          <section class="comparison-pair" aria-labelledby="pair-${escapeHtml(exemplar.id)}">
            <header class="pair-header">
              <h3 id="pair-${escapeHtml(exemplar.id)}">${escapeHtml(exemplar.state)}</h3>
              <p><code>${escapeHtml(exemplar.storyId)}</code> · ${exemplar.viewport.width}x${exemplar.viewport.height}</p>
            </header>
            <div class="theme-pair">${pair.map(renderReviewCard).join("")}
            </div>
          </section>`;
        }).join("")}
        </div>
      </section>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>GitLab Review Workspace design review board</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; background: Canvas; color: CanvasText; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    header, main { width: min(1760px, 100%); margin: 0 auto; }
    .board-header { position: sticky; top: 0; z-index: 10; padding: 16px 24px; border-bottom: 1px solid color-mix(in srgb, CanvasText 20%, transparent); background: color-mix(in srgb, Canvas 94%, transparent); backdrop-filter: blur(10px); }
    .board-header h1 { margin: 0 0 4px; font-size: 20px; }
    .board-header p { margin: 0; color: color-mix(in srgb, CanvasText 72%, transparent); }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    button { min-height: 32px; padding: 5px 10px; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); border-radius: 4px; background: Canvas; color: CanvasText; font: inherit; cursor: pointer; }
    button[aria-pressed="true"] { border-color: Highlight; outline: 1px solid Highlight; background: color-mix(in srgb, Highlight 16%, Canvas); }
    button:focus-visible, a:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    main { padding: 24px; }
    h2 { margin: 32px 0 12px; font-size: 18px; }
    h3 { margin: 0; font-size: 15px; }
    h4 { margin: 0; font-size: 14px; text-transform: capitalize; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .overview { padding: 16px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 6px; }
    .overview > h2 { margin-top: 0; }
    .overview-group + .overview-group { margin-top: 20px; }
    .thumbnail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 8px; }
    .thumbnail { display: grid; gap: 5px; min-width: 0; padding: 6px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 4px; color: inherit; text-decoration: none; }
    .thumbnail img { display: block; width: 100%; height: 120px; object-fit: contain; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .thumbnail span { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .comparison-list { display: grid; gap: 24px; }
    .comparison-pair { min-width: 0; padding-top: 12px; border-top: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .pair-header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .pair-header p { margin: 0; color: color-mix(in srgb, CanvasText 68%, transparent); font-size: 12px; }
    .theme-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .review-card { min-width: 0; overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 6px; background: Canvas; }
    .review-card-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
    .review-card-header code { color: color-mix(in srgb, CanvasText 68%, transparent); font-size: 11px; }
    .review-image { display: block; padding: 10px; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    .review-image img { display: block; width: 100%; height: auto; max-height: 900px; object-fit: contain; object-position: top center; }
    .review-card-details { display: grid; gap: 6px; margin: 0; padding: 10px; font-size: 12px; }
    .review-card-details div { display: grid; grid-template-columns: minmax(80px, 0.25fr) 1fr; gap: 8px; }
    .review-card-details dt { color: color-mix(in srgb, CanvasText 65%, transparent); }
    .review-card-details dd { min-width: 0; margin: 0; }
    body.is-grayscale img { filter: grayscale(1); }
    body.is-compact .comparison-list { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    body.is-compact .theme-pair { gap: 6px; }
    body.is-compact .review-card-header { padding: 5px 6px; }
    body.is-compact .review-card-header code, body.is-compact .review-card-details { display: none; }
    body.is-compact .review-image { padding: 4px; }
    body.is-compact .review-image img { height: 180px; object-fit: contain; }
    @media (max-width: 760px) { .theme-pair { grid-template-columns: 1fr; } .board-header, main { padding-left: 12px; padding-right: 12px; } }
    @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
  </style>
</head>
<body>
  <header class="board-header">
    <h1>GitLab Review Workspace design review board</h1>
    <p>Start with compact thumbnails, repeat in grayscale, then inspect paired screenshots at full size.</p>
    <div class="controls" aria-label="Review display controls">
      <button type="button" data-class="is-grayscale" aria-pressed="false">Grayscale</button>
      <button type="button" data-class="is-compact" aria-pressed="false">Compact thumbnail review</button>
    </div>
  </header>
  <main>
    <section class="overview" aria-labelledby="overview-heading">
      <h2 id="overview-heading">First-glance overview</h2>${overview}
    </section>
    <div class="comparisons">${comparisons}
    </div>
  </main>
  <script>
    for (const control of document.querySelectorAll("[data-class]")) {
      control.addEventListener("click", () => {
        const className = control.dataset.class;
        const active = document.body.classList.toggle(className);
        control.setAttribute("aria-pressed", String(active));
      });
    }
  </script>
</body>
</html>
`;
}

async function waitForStableLayout(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });

  let previous = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await page.evaluate(() => JSON.stringify({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      root: document.querySelector("#storybook-root")?.getBoundingClientRect().toJSON()
    }));
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(125);
  }
}

function readPngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error("Captured screenshot is not a PNG with a readable image extent.");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function captureStoryCase(browser, baseUrl, outputDirectory, captureCase) {
  const context = await browser.newContext({
    viewport: captureCase.viewport,
    colorScheme: captureCase.theme,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    const storyUrl = new URL("iframe.html", baseUrl);
    storyUrl.searchParams.set("id", captureCase.storyId);
    storyUrl.searchParams.set("viewMode", "story");
    storyUrl.searchParams.set("globals", `vscodeTheme:${captureCase.theme}`);

    await page.goto(storyUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(`.storybook-vscode-root.vscode-${captureCase.theme}`, { state: "visible", timeout: 20_000 });
    if (captureCase.ready?.selector) {
      await page.waitForSelector(captureCase.ready.selector, { state: "visible", timeout: 20_000 });
    }
    if (captureCase.ready?.text) {
      await page.getByText(captureCase.ready.text, { exact: true }).first().waitFor({ state: "visible", timeout: 20_000 });
    }
    await page.addStyleTag({ content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    ` });
    await waitForStableLayout(page);
    if (pageErrors.length > 0) throw new Error(`Browser error in ${captureCase.id}: ${pageErrors.join("; ")}`);
    const viteErrorOverlay = page.locator("vite-error-overlay").first();
    if (await viteErrorOverlay.isVisible()) {
      const overlayText = (await viteErrorOverlay.textContent())?.replace(/\s+/g, " ").trim();
      throw new Error(`Vite error overlay in ${captureCase.id}: ${overlayText || "rendering failed"}`);
    }
    if (consoleErrors.length > 0) throw new Error(`Console error in ${captureCase.id}: ${consoleErrors.join("; ")}`);

    const filename = `${captureCase.id}.png`;
    const absolutePath = resolve(outputDirectory, filename);
    const captureMode = captureCase.captureMode ?? "full-page";
    await page.screenshot({ path: absolutePath, fullPage: captureMode === "full-page", animations: "disabled", caret: "hide" });
    const bytes = await readFile(absolutePath);
    const imageExtent = readPngDimensions(bytes);
    return {
      id: captureCase.id,
      surface: captureCase.surface,
      state: captureCase.state,
      designFocus: captureCase.designFocus,
      storyId: captureCase.storyId,
      theme: captureCase.theme,
      viewport: captureCase.viewport,
      captureMode,
      imageExtent,
      ...(captureCase.evidenceLane === undefined ? {} : { evidenceLane: captureCase.evidenceLane }),
      ...(captureCase.evidenceLanes === undefined ? {} : { evidenceLanes: captureCase.evidenceLanes }),
      ...(captureCase.pairId === undefined ? {} : { pairId: captureCase.pairId }),
      ...(captureCase.stateVector === undefined ? {} : { stateVector: captureCase.stateVector }),
      ...(captureCase.metadata === undefined ? {} : { metadata: captureCase.metadata }),
      file: filename,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const outputDirectory = resolve(repositoryRoot, options.output);
  const casesPath = resolve(repositoryRoot, "tests/ui/cases.json");
  const allCases = validateCases(JSON.parse(await readFile(casesPath, "utf8")));
  const requestedIds = new Set(options.caseIds);
  const cases = requestedIds.size === 0 ? allCases : allCases.filter((captureCase) => requestedIds.has(captureCase.id));
  const missingIds = [...requestedIds].filter((id) => !allCases.some((captureCase) => captureCase.id === id));
  if (missingIds.length > 0) throw new Error(`Unknown capture case(s): ${missingIds.join(", ")}`);

  await mkdir(outputDirectory, { recursive: true });
  let storybook;
  let browser;
  try {
    if (!(await isAvailable(baseUrl))) {
      storybook = startStorybook(baseUrl);
      await waitForStorybook(baseUrl, storybook);
      console.log(`Started fixture-only Storybook at ${baseUrl}.`);
    } else {
      console.log(`Using Storybook at ${baseUrl}.`);
    }

    browser = await chromium.launch({ headless: true });
    const manifestCases = [];
    for (const captureCase of cases) {
      manifestCases.push(await captureStoryCase(browser, baseUrl, outputDirectory, captureCase));
      console.log(`Captured ${captureCase.id}.`);
    }

    const reviewBoard = "review-board.html";
    const manifest = { schemaVersion: 2, reviewBoard, cases: manifestCases };
    await writeFile(resolve(outputDirectory, reviewBoard), createReviewBoard(manifestCases), "utf8");
    await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Wrote ${manifestCases.length} screenshot(s), manifest.json, and ${reviewBoard} to ${outputDirectory}.`);
  } finally {
    await browser?.close();
    await stopStorybook(storybook);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
