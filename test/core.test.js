import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, summarize, reportText } from "../src/core.js";
test("quoted commas, escaped quotes, BOM and CRLF are parsed", () =>
  assert.deepEqual(parseCSV('\uFEFFa,b\r\n"x,y","a""b"\r\n'), [
    ["a", "b"],
    ["x,y", 'a"b'],
  ]));
test("malformed and uneven CSV fails closed", () => {
  for (const data of ['a,b\n"x,y', "a,b\nx", 'a,b\n"x"z,y'])
    assert.throws(() => parseCSV(data));
});
test("empty and heading-only CSV do not count as attendance", () => {
  assert.throws(() => parseCSV(""));
  assert.throws(() => parseCSV("date,division,status\n"));
});
test("small status groups in a larger division remain explicitly described as sensitive", () => {
  const report = reportText(
    [
      {
        division: "Junior School (PYP)",
        present: 9,
        late: 0,
        absent: 1,
        leave: 0,
      },
    ],
    "2026-10-29",
  );
  assert.match(report, /Absent: 1/);
  assert.match(report, /may still be sensitive/);
});
test("email only renders explicit aggregate fields", () => {
  const report = reportText(
    [
      {
        division: "Junior School (PYP)",
        present: 9,
        late: 0,
        absent: 1,
        leave: 0,
        student_code: "S-PRIVATE1",
        name: "PRIVATE_NAME",
      },
    ],
    "2026-10-29",
  );
  assert.doesNotMatch(report, /PRIVATE/);
});
test("rate counts present only, with leave in denominator", () => {
  const d = summarize({
    division: "Finance",
    present: 5,
    remote: 0,
    late: 3,
    absent: 1,
    leave: 1,
  });
  assert.equal(d.total, 10);
  assert.equal(d.attending, 5);
  assert.equal(d.rate, 50);
});
test("small division details are withheld from emails", () => {
  const report = reportText(
    [
      {
        division: "Finance",
        present: 1,
        remote: 0,
        late: 0,
        absent: 1,
        leave: 0,
      },
    ],
    "2026-10-29",
  );
  assert.match(report, /Details withheld/);
  assert.doesNotMatch(report, /Present: 1|Absent: 1|50.0%/);
});
