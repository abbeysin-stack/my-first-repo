import type { Dataset, Status } from "../types.ts";
import { division, monthDays } from "./analytics.ts";
export const emptyData = (): Dataset => ({
  records: [],
  roster: [],
  totals: [],
  metrics: [],
  enrollment: [],
  calendar: [],
  finalized: [],
  recordMeta: [],
  serverTime: "",
});
export function demoData(date: string): Dataset {
  const data = emptyData(),
    names = [
      "Ava R.",
      "Noah K.",
      "Maya S.",
      "Leo P.",
      "Isla J.",
      "Ethan B.",
      "Aria T.",
      "Liam D.",
      "Nora Q.",
      "Finn C.",
    ];
  data.roster = Array.from({ length: 120 }, (_, i) => ({
    student_code: "S-DEMO" + String(i).padStart(8, "0"),
    display_name: names[i % 10],
    registration_number: "DEMO-" + String(i + 1).padStart(4, "0"),
    grade: String(Math.floor(i / 10) + 1),
    class_name: `${Math.floor(i / 10) + 1}-${i % 10 < 5 ? "A" : "B"}`,
    house: ["Cedar", "Maple", "Oak", "Willow"][i % 4],
  }));
  const days = monthDays(date.slice(0, 7)).filter(
    (d) =>
      d <= date && ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()),
  );
  for (const [dayIndex, day] of days.entries())
    for (const [i, s] of data.roster.entries()) {
      let status: Status =
        (i + dayIndex) % 29 === 0
          ? "absent"
          : (i + dayIndex) % 43 === 0
            ? "excused"
            : (i + dayIndex) % 47 === 0
              ? "late"
              : "present";
      if (day.endsWith("-08") && i % 5 === 0) status = "absent";
      if (i === 13 && dayIndex >= days.length - 3) status = "absent";
      if (i === 65 && dayIndex % 3 === 0) status = "absent";
      data.records.push({
        date: day,
        student_code: s.student_code,
        grade: s.grade,
        division: division(s.grade),
        status,
        ...(status === "absent"
          ? {
              reason: "unexplained",
              parent_notified: i % 2 === 0,
              note: "Fictional attendance follow-up for demonstration.",
            }
          : {}),
        ...(status === "excused"
          ? { reason: "school_event", parent_notified: true }
          : {}),
        ...(status === "late" ? { arrival_time: "08:25" } : {}),
      });
    }
  data.records = data.records.filter(
    (r) => !(r.date === date && r.grade === "1"),
  );
  data.totals = [
    {
      date,
      grade: "1",
      total: 10,
      present: 8,
      absent: 1,
      leave: 0,
      late: 0,
      excused: 1,
      half_day: 0,
    },
  ];
  data.serverTime = new Date().toISOString();
  return data;
}
