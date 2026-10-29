import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { emptyData, demoData } from "../web/lib/demo.ts";
import {
  daily,
  risks,
  heatLevel,
  validSchoolDay,
  emptyFilters,
} from "../web/lib/analytics.ts";
import { briefing, mimeDraft } from "../web/lib/email.ts";
import { workbook } from "../web/lib/workbook.ts";
test("calendar thresholds, zero data and closed days are explicit", () => {
  assert.equal(heatLevel(null), "none");
  assert.equal(heatLevel(95), "goal");
  assert.equal(heatLevel(94.9), "normal");
  assert.equal(heatLevel(89.9), "warning");
  assert.equal(heatLevel(84.9), "critical");
  assert.equal(daily(emptyData(), "2026-10-29").rate, null);
  assert.equal(validSchoolDay("2026-10-31", []), false);
  assert.equal(
    validSchoolDay("2026-10-29", [
      { date: "2026-10-29", label: "School closed" },
    ]),
    false,
  );
});
test("consecutive unexplained absence warning breaks on missing instructional dates", () => {
  const data = emptyData();
  data.roster = [
    {
      student_code: "S-A7K9M2Q4",
      display_name: "PRIVATE_NAME",
      registration_number: "PRIVATE_REG",
      grade: "3",
    },
  ];
  data.records = ["2026-10-27", "2026-10-28", "2026-10-29"].map((date) => ({
    date,
    student_code: "S-A7K9M2Q4",
    grade: "3",
    division: "Junior School (PYP)",
    status: "absent",
    reason: "unexplained",
  }));
  assert.equal(risks(data, "2026-10-29")[0].consecutive, 3);
  data.records = data.records.filter((r) => r.date !== "2026-10-28");
  assert.equal(risks(data, "2026-10-29")[0].consecutive, 1);
});
test("briefing is multipart, aggregate-only and not called finalized with incomplete scope", () => {
  const data = demoData("2026-10-29");
  data.roster[0].display_name = "PRIVATE_NAME";
  data.roster[0].registration_number = "PRIVATE_REG";
  data.records[0].note = "PRIVATE_NOTE";
  data.finalized = [
    { date: "2026-10-29", grade: "1", finalized_at: "now", finalized_by: 1 },
  ];
  let message = briefing(data, "2026-10-29");
  assert.match(message.subject, /DRAFT/);
  assert.doesNotMatch(
    message.text + message.html,
    /PRIVATE_NAME|PRIVATE_REG|PRIVATE_NOTE|S-DEMO/,
  );
  const filtered = briefing(data, "2026-10-29", "all", {
    ...emptyFilters,
    grade: "3",
  });
  assert.match(filtered.text, /Recorded: 10/);
  assert.doesNotMatch(filtered.text, /Secondary \(IB DP\)/);
  const mime = mimeDraft(message);
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /Content-Type: text\/html/);
  assert.match(message.html, /table-layout:fixed/);
  data.finalized = Array.from({ length: 12 }, (_, i) => ({
    date: "2026-10-29",
    grade: String(i + 1),
    finalized_at: "now",
    finalized_by: 1,
  }));
  message = briefing(data, "2026-10-29");
  assert.doesNotMatch(message.subject, /DRAFT/);
});
test("Excel export is a structured OOXML workbook with escaped literal cells, not formulas", () => {
  const bytes = workbook([
    {
      name: "Board summary",
      rows: [
        ["Division", "Recorded"],
        ["Junior & Middle", 120],
        ["=not-a-formula", "<plain>"],
      ],
    },
  ]);
  const files = unzipSync(bytes);
  assert.ok(files["[Content_Types].xml"]);
  assert.ok(files["xl/workbook.xml"]);
  const xml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /Junior &amp; Middle/);
  assert.match(xml, /&lt;plain&gt;/);
  assert.doesNotMatch(xml, /<f>/);
  assert.match(xml, /state="frozen"/);
});
