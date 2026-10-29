import type { Attendance, Counts, Dataset, Risk, Student } from "../types.ts";
const keys = [
  "present",
  "absent",
  "late",
  "leave",
  "excused",
  "half_day",
] as const;
export const emptyCounts = (): Counts => ({
  present: 0,
  absent: 0,
  late: 0,
  leave: 0,
  excused: 0,
  half_day: 0,
});
export const total = (counts: Counts) =>
  keys.reduce((n, k) => n + (counts[k] || 0), 0);
export function validSchoolDay(date: string, calendar: Dataset["calendar"]) {
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return day !== 0 && day !== 6 && !calendar.some((d) => d.date === date);
}
export function division(grade: string) {
  const n = Number(grade);
  return n <= 5
    ? "Junior School (PYP)"
    : n <= 7
      ? "Junior School (MYP)"
      : n <= 10
        ? "Secondary (IGCSE)"
        : "Secondary (IB DP)";
}
export interface Filters {
  division: string;
  grade: string;
  house: string;
  class_name: string;
}
export const emptyFilters: Filters = {
  division: "all",
  grade: "all",
  house: "all",
  class_name: "all",
};
export function matching(s: Student, f: Filters) {
  return (
    (f.division === "all" || division(s.grade) === f.division) &&
    (f.grade === "all" || s.grade === f.grade) &&
    (f.house === "all" || s.house === f.house) &&
    (f.class_name === "all" || s.class_name === f.class_name)
  );
}
export function rollups(
  data: Dataset,
  date: string,
  f: Filters = emptyFilters,
) {
  const groups = new Map<string, Counts>();
  const add = (name: string, values: Partial<Counts>) => {
    if (!groups.has(name)) groups.set(name, emptyCounts());
    for (const key of keys) groups.get(name)![key] += values[key] || 0;
  };
  if (!data.records.length && !data.totals.length && data.metrics.length) {
    for (const row of data.metrics.filter(
      (m) =>
        m.date === date && (f.division === "all" || m.division === f.division),
    ))
      add(row.division, row);
    return [...groups].map(([division, counts]) => ({ division, ...counts }));
  }
  const roster = new Map(data.roster.map((s) => [s.student_code, s]));
  const overridden = new Set(
    data.totals.filter((t) => t.date === date).map((t) => t.grade),
  );
  for (const r of data.records.filter(
    (r) => r.date === date && !overridden.has(r.grade),
  )) {
    const s = roster.get(r.student_code) || {
      student_code: r.student_code,
      grade: r.grade,
    };
    if (
      matching(
        {
          ...s,
          grade: r.grade,
          class_name: r.class_name || s.class_name,
          house: r.house || s.house,
        },
        f,
      )
    )
      add(r.division, { [r.status]: 1 });
  }
  for (const t of data.totals.filter((t) => t.date === date)) {
    if (f.class_name !== "all" || f.house !== "all") continue;
    if (
      (f.division === "all" || division(t.grade) === f.division) &&
      (f.grade === "all" || f.grade === t.grade)
    )
      add(division(t.grade), t);
  }
  return [...groups].map(([division, counts]) => ({ division, ...counts }));
}
export function daily(data: Dataset, date: string, f: Filters = emptyFilters) {
  const counts = rollups(data, date, f).reduce((sum, row) => {
    for (const key of keys) sum[key] += row[key];
    return sum;
  }, emptyCounts());
  const recorded = total(counts);
  return {
    ...counts,
    recorded,
    rate: recorded ? (100 * counts.present) / recorded : null,
  };
}
export function enrollment(data: Dataset, f: Filters = emptyFilters) {
  if (!data.roster.length && data.enrollment.length)
    return data.enrollment
      .filter((e) => f.division === "all" || f.division === e.division)
      .reduce((n, e) => n + e.total, 0);
  return data.roster.filter((s) => matching(s, f)).length;
}
export function monthDays(month: string) {
  const [year, m] = month.split("-").map(Number);
  return Array.from(
    { length: new Date(Date.UTC(year, m, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
}
export function heatLevel(rate: number | null) {
  return rate === null
    ? "none"
    : rate >= 95
      ? "goal"
      : rate >= 90
        ? "normal"
        : rate >= 85
          ? "warning"
          : "critical";
}
export function risks(
  data: Dataset,
  asOf: string,
  f: Filters = emptyFilters,
): Risk[] {
  const result: Risk[] = [];
  for (const student of data.roster.filter((s) => matching(s, f))) {
    const history = data.records
      .filter(
        (r) =>
          r.student_code === student.student_code &&
          r.date <= asOf &&
          validSchoolDay(r.date, data.calendar),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!history.length) continue;
    const present = history.filter((r) => r.status === "present").length;
    const rate = (100 * present) / history.length;
    const absences = history.filter((r) => r.status === "absent").length;
    let consecutive = 0;
    // A missing instructional date breaks the streak; weekends and configured holidays do not.
    let cursor = asOf;
    const byDate = new Map(history.map((r) => [r.date, r]));
    for (let i = 0; i < 370; i++) {
      if (validSchoolDay(cursor, data.calendar)) {
        const r = byDate.get(cursor);
        if (
          !r ||
          r.status !== "absent" ||
          !["unexplained", ""].includes(r.reason || "")
        )
          break;
        consecutive++;
      }
      const date = new Date(cursor + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() - 1);
      cursor = date.toISOString().slice(0, 10);
    }
    if (rate < 90 || consecutive >= 3)
      result.push({
        student,
        rate,
        days: history.length,
        absences,
        consecutive,
        level: consecutive >= 3 ? "consecutive" : "chronic",
      });
  }
  return result.sort(
    (a, b) => b.consecutive - a.consecutive || a.rate - b.rate,
  );
}
export function makeRecord(
  student: Student,
  date: string,
  status: Attendance["status"],
): Attendance {
  return {
    date,
    student_code: student.student_code,
    grade: student.grade,
    division: division(student.grade),
    status,
  };
}
