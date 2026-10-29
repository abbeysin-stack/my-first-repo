import { existsSync } from "node:fs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { once } from "node:events";
const server = await createApp({
  dbPath: ":memory:",
  allowSetup: true,
  production: false,
  appOrigin: "",
  microsoftConfig: {},
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
async function api(path, body, cookie, method = "POST") {
  return fetch(base + path, {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
const admin = await api("/api/setup", {
  username: "test.admin",
  password: "fictional-admin-password",
});
const adminCookie = admin.headers.get("set-cookie").split(";")[0];
await api(
  "/api/users",
  { username: "test.teacher", password: "fictional-teacher-password" },
  adminCookie,
);
const users = await (
  await fetch(base + "/api/users", { headers: { Cookie: adminCookie } })
).json();
await api(
  "/api/access",
  {
    id: users.users.find((u) => u.username === "test.teacher").id,
    persona: "teacher",
    assigned_class: "3-A",
  },
  adminCookie,
  "PATCH",
);
await api(
  "/api/roster",
  {
    students: [
      {
        student_code: "S-CLASSA01",
        display_name: "Lena T.",
        registration_number: "000321",
        grade: "3",
        class_name: "3-A",
      },
      {
        student_code: "S-CLASSB01",
        display_name: "Jude R.",
        registration_number: "000322",
        grade: "3",
        class_name: "3-B",
      },
    ],
  },
  adminCookie,
);
await api(
  "/api/records",
  {
    records: [
      {
        date: "2026-10-29",
        student_code: "S-CLASSA01",
        grade: "3",
        division: "Junior School (PYP)",
        status: "absent",
        reason: "family",
      },
      {
        date: "2026-10-29",
        student_code: "S-CLASSB01",
        grade: "3",
        division: "Junior School (PYP)",
        status: "present",
      },
    ],
  },
  adminCookie,
);
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
});
const teacher = await browser.newPage();
const secretary = await browser.newPage();
const errors = [];
for (const page of [teacher, secretary])
  page.on("pageerror", (e) => errors.push(e.message));
async function login(page, name, password) {
  await page.goto(base);
  await page.getByLabel("Staff username").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".sidebar").waitFor();
  await page.locator("input[type=date]").fill("2026-10-29");
}
try {
  await login(teacher, "test.teacher", "fictional-teacher-password");
  await teacher
    .getByRole("heading", { name: "Your classroom, accounted for." })
    .waitFor();
  assert.equal(await teacher.locator(".roster-table tbody tr").count(), 1);
  assert.doesNotMatch(
    await teacher.locator("body").innerText(),
    /Jude R|000322/,
  );
  assert.equal(
    await teacher
      .locator(".sidebar nav")
      .getByRole("button", { name: "Secretary", exact: true })
      .count(),
    0,
  );
  await login(secretary, "test.admin", "fictional-admin-password");
  await secretary.getByLabel("Secretary grade").selectOption("3");
  await secretary
    .locator(".roster-table")
    .getByText("Lena T.", { exact: true })
    .waitFor();
  await teacher.route("**/api/records", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await teacher
    .getByRole("button", { name: "Mark Lena T. present", exact: true })
    .click();
  await teacher.getByText("1 pending", { exact: true }).waitFor();
  assert.match(
    await secretary
      .locator(".roster-table tbody tr")
      .filter({ hasText: "Lena T." })
      .innerText(),
    /Absent/,
  );
  await teacher.unroute("**/api/records");
  await teacher.evaluate(() => window.dispatchEvent(new Event("online")));
  await secretary
    .locator(".roster-table tbody tr")
    .filter({ hasText: "Lena T." })
    .locator(".status-pill")
    .filter({ hasText: "Present" })
    .waitFor({ timeout: 5000 });
  await teacher.waitForFunction(
    () =>
      !document.querySelector(".live-label")?.textContent.includes("pending"),
  );
  const data = await (
    await fetch(base + "/api/records", { headers: { Cookie: adminCookie } })
  ).json();
  assert.equal(
    data.records.find((r) => r.student_code === "S-CLASSA01").status,
    "present",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Live browser checks passed: real teacher class scope, hidden out-of-class identities, memory-buffered failed write, successful retry, and secretary update via SSE without reloading.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
