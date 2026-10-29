import { existsSync } from "node:fs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
const server = await createApp({
  dbPath: ":memory:",
  production: false,
  appOrigin: "",
  microsoftConfig: {},
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Explore fictional demo" }).click();
  await page
    .getByRole("heading", { name: "Secretary attendance desk" })
    .waitFor();
  await page.locator("input[type=date]").fill("2026-10-29");
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("textbox", { name: "Search all authorized students" })
    .fill("DEMO-0014");
  await page.locator(".search-results button").first().click();
  await page
    .getByRole("heading", { name: "Record attendance", exact: true })
    .waitFor();
  await page
    .getByLabel("Staff note", { exact: false })
    .fill('PRIVATE_NOTE <img src=x onerror="window.XSS=1">');
  await page.getByLabel("Parent / guardian contact confirmed").check();
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => !document.querySelector("dialog"));
  assert.equal(await page.locator(".roster-table img").count(), 0);
  assert.equal(await page.evaluate(() => window.XSS), undefined);
  assert.match(await page.locator(".roster-table").innerText(), /PRIVATE_NOTE/);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search all authorized students" })
    .fill("no-such-student");
  assert.match(
    await page.locator(".search-results").innerText(),
    /No students/,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog").count(), 0);
  await page.screenshot({
    path: "/tmp/attendance-platform-secretary.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Teacher", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your classroom, accounted for." })
    .waitFor();
  assert.equal(await page.locator(".roster-table tbody tr").count(), 5);
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Division head", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Students to check in with" })
    .waitFor();
  assert.ok((await page.locator("table tbody tr").count()) > 0);
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Head of school", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Monthly attendance health" })
    .waitFor();
  assert.equal(await page.locator(".calendar-day").count(), 31);
  assert.equal(
    await page
      .getByRole("heading", { name: "Students to check in with" })
      .count(),
    0,
  );
  await page
    .frameLocator('iframe[title="Leadership email preview"]')
    .getByRole("heading", { name: "Daily attendance briefing" })
    .waitFor();
  const preview = await page
    .locator('iframe[title="Leadership email preview"]')
    .getAttribute("srcdoc");
  assert.doesNotMatch(preview, /PRIVATE_NOTE|DEMO-0014|Leo P\./);
  assert.match(preview, /FICTIONAL DEMO/);
  const [eml] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Outlook draft (.eml)" }).click(),
  ]);
  const mime = await readFile(await eml.path(), "utf8");
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /Content-Type: text\/html/);
  const [excel] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Excel", exact: true }).click(),
  ]);
  const zip = unzipSync(new Uint8Array(await readFile(await excel.path())));
  assert.ok(zip["xl/workbook.xml"]);
  const worksheetText = Object.values(zip).map(strFromU8).join("");
  assert.doesNotMatch(worksheetText, /PRIVATE_NOTE|DEMO-0014|Leo P\./);
  await writeFile(
    "/tmp/attendance-platform-board.xlsx",
    await readFile(await excel.path()),
  );
  const [png] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: "Board PNG", exact: true }).click(),
  ]);
  const pngBytes = await readFile(await png.path());
  assert.ok(pngBytes.length > 1000);
  assert.equal(pngBytes.subarray(1, 4).toString(), "PNG");
  await writeFile("/tmp/attendance-platform-board.png", pngBytes);
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: "/tmp/attendance-platform-board.pdf",
    format: "A4",
    landscape: true,
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({
    path: "/tmp/attendance-platform-executive.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/attendance-platform-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "Secretary", exact: true })
    .click();
  await page.getByRole("button", { name: "Verify & finalize" }).click();
  await page.getByRole("status").filter({ hasText: "finalized" }).waitFor();
  assert.equal(
    await page
      .locator(".roster-table button")
      .filter({ hasText: "Present" })
      .first()
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Review browser checks passed: four workspaces, Ctrl+K, Esc and Ctrl+Enter, names/notes safety, teacher class view, risk signals, monthly calendar, aggregate-only HTML/multipart EML/XLSX/PNG/PDF, mobile width, finalization locks.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
