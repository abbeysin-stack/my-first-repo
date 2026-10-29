import { divisionForGrade, validateRecord } from "./students.js";
export const absenceReasons = {
  illness: "Illness",
  appointment: "Appointment",
  family: "Family reason",
  authorized: "Authorized absence",
  unexplained: "Unexplained / awaiting confirmation",
};
export function validateTotals(value) {
  if (
    !value ||
    typeof value.date !== "string" ||
    typeof value.grade !== "string"
  )
    throw Error("Select a reporting date and grade.");
  validateRecord({
    date: value.date,
    grade: value.grade,
    division: divisionForGrade(value.grade),
    student_code: "S-VALIDATE",
    status: "present",
  });
  const clean = { date: value.date, grade: value.grade };
  for (const key of [
    "total",
    "absent",
    "leave",
    "late",
    "excused",
    "half_day",
  ]) {
    if (
      !Number.isSafeInteger(value[key] ?? 0) ||
      (value[key] ?? 0) < 0 ||
      (value[key] ?? 0) > 10000
    )
      throw Error("Counts must be whole numbers between 0 and 10,000.");
    clean[key] = value[key] ?? 0;
  }
  if (clean.total === 0)
    throw Error("Enter a student count greater than zero.");
  if (
    clean.absent + clean.leave + clean.late + clean.excused + clean.half_day >
    clean.total
  )
    throw Error(
      "Absent, leave, and late counts cannot exceed the student count.",
    );
  return {
    ...clean,
    present:
      clean.total -
      clean.absent -
      clean.leave -
      clean.late -
      clean.excused -
      clean.half_day,
  };
}
export function aggregateAttendance(records, totals, date) {
  const counts = totals.filter((t) => t.date === date),
    overridden = new Set(counts.map((t) => t.grade)),
    groups = new Map();
  const add = (division, values) => {
    if (!groups.has(division))
      groups.set(division, {
        division,
        present: 0,
        absent: 0,
        leave: 0,
        late: 0,
        excused: 0,
        half_day: 0,
      });
    for (const k of [
      "present",
      "absent",
      "leave",
      "late",
      "excused",
      "half_day",
    ])
      groups.get(division)[k] += values[k] || 0;
  };
  for (const r of records.filter(
    (r) => r.date === date && !overridden.has(r.grade),
  ))
    add(r.division, { [r.status]: 1 });
  for (const t of counts) add(divisionForGrade(t.grade), t);
  return [...groups.values()];
}
export function rosterForGrade(roster, records, grade, date) {
  const map = new Map(
    roster.filter((s) => s.grade === grade).map((s) => [s.student_code, s]),
  );
  // Include recorded students even if a current roster was not imported yet.
  for (const r of records.filter((r) => r.grade === grade && r.date === date))
    if (!map.has(r.student_code))
      map.set(r.student_code, { student_code: r.student_code, grade });
  const today = new Map(
    records.filter((r) => r.date === date).map((r) => [r.student_code, r]),
  );
  return [...map.values()]
    .sort(
      (a, b) =>
        (a.display_name || a.student_code).localeCompare(
          b.display_name || b.student_code,
        ) ||
        (a.registration_number || "").localeCompare(
          b.registration_number || "",
        ),
    )
    .map((s) => ({
      ...s,
      record:
        today.get(s.student_code)?.grade === grade
          ? today.get(s.student_code)
          : undefined,
    }));
}
