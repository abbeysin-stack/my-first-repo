import type { Dataset } from "../types.ts";
import {
  rollups,
  total,
  emptyFilters,
  matching,
  type Filters,
} from "./analytics.ts";
export const escapeHTML = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function briefing(
  data: Dataset,
  date: string,
  scope = "all",
  filters: Filters = emptyFilters,
) {
  const rows = rollups(data, date, filters).filter(
    (r) => scope === "all" || r.division === scope,
  );
  const gradeDivision = (g: string) =>
    Number(g) <= 5
      ? "Junior School (PYP)"
      : Number(g) <= 7
        ? "Junior School (MYP)"
        : Number(g) <= 10
          ? "Secondary (IGCSE)"
          : "Secondary (IB DP)";
  const candidates = data.expectedGrades || [
    ...new Set([
      ...data.roster.map((s) => s.grade),
      ...data.totals.filter((t) => t.date === date).map((t) => t.grade),
    ]),
  ];
  const expected = (
    candidates.length
      ? candidates
      : Array.from({ length: 12 }, (_, i) => String(i + 1))
  ).filter(
    (g) =>
      (scope === "all" || gradeDivision(g) === scope) &&
      (filters.division === "all" || gradeDivision(g) === filters.division) &&
      (filters.grade === "all" || g === filters.grade) &&
      ((filters.class_name === "all" && filters.house === "all") ||
        data.roster.some(
          (student) => student.grade === g && matching(student, filters),
        )),
  );
  const finalized =
    rows.length > 0 &&
    expected.length > 0 &&
    expected.every((g) =>
      data.finalized.some((f) => f.date === date && f.grade === g),
    );
  const lines = [
    `DAILY ATTENDANCE | ${date}`,
    finalized
      ? "FINALIZED — all expected grades in this reporting scope are locked."
      : "DRAFT — attendance has not been finalized.",
    "",
    "Dear leadership team,",
    `Please find the attendance update for ${date}.`,
    "",
  ];
  const tableRows = rows
    .map((row) => {
      const n = total(row);
      lines.push(row.division);
      if (n < 5) {
        lines.push("Details withheld: fewer than five recorded students.", "");
        return `<tr><td>${escapeHTML(row.division)}</td><td colspan="7">Withheld: fewer than 5 students</td></tr>`;
      }
      const rate = ((100 * row.present) / n).toFixed(1) + "%";
      lines.push(
        `Recorded: ${n} | Present: ${row.present} | Absent: ${row.absent} | Excused / leave: ${row.excused + row.leave} | Late: ${row.late} | Half-day: ${row.half_day} | Attendance: ${rate}`,
        "",
      );
      return `<tr><td>${escapeHTML(row.division)}</td>${[n, row.present, row.absent, row.excused + row.leave, row.late, row.half_day, rate].map((v) => `<td>${v}</td>`).join("")}</tr>`;
    })
    .join("");
  const coverage =
    data.finalized
      .filter(
        (f) =>
          f.date === date &&
          (scope === "all" || gradeDivision(f.grade) === scope),
      )
      .map((f) => f.grade)
      .sort((a, b) => Number(a) - Number(b))
      .join(", ") || "None";
  const cohort =
    Object.entries(filters)
      .filter(([, v]) => v !== "all")
      .map(([k, v]) => `${k.replace("_", " ")}: ${v}`)
      .join(", ") || "all visible students";
  const basis = `Reporting cohort: ${cohort}. Finalized grades: ${coverage}. Attendance rate = present ÷ all submitted records. Late, excused, leave and half-day remain separate and are not counted as present. Counts may be incomplete before all grades are finalized. Personal details and staff notes are excluded. Small groups may still permit inference. Review recipients before sending.`;
  lines.push(basis, "", "Regards,", "School Attendance Office");
  const text = lines.join("\n");
  const cell =
    "padding:12px 8px;border-bottom:1px solid #e2e8f0;text-align:left;font-family:Arial,sans-serif;font-size:12px";
  const table = `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><thead><tr>${["Division", "Recorded", "Present", "Absent", "Excused / leave", "Late", "Half-day", "Rate"].map((v) => `<th style="${cell};background:#eef2ff">${v}</th>`).join("")}</tr></thead><tbody>${tableRows.replaceAll("<td>", `<td style="${cell}">`).replaceAll('<td colspan="7">', `<td colspan="7" style="${cell}">`)}</tbody></table>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="800" cellpadding="0" cellspacing="0" style="width:800px;max-width:100%;table-layout:fixed;background:white;font-family:Arial,sans-serif;color:#0f172a"><tr><td style="padding:28px;background:#0f172a;color:white"><p style="font-size:11px;letter-spacing:2px">ATTEND · SCHOOL OPERATIONS</p><h1 style="font-size:26px">Daily attendance briefing</h1><p>${escapeHTML(date)} · ${finalized ? "FINALIZED REGISTERS" : "DRAFT FOR REVIEW"}</p></td></tr><tr><td style="padding:24px"><p>Dear leadership team,</p><p>Please find the consolidated daily attendance update.</p>${table}<p style="margin-top:24px;font-size:12px;line-height:1.7;color:#64748b">${escapeHTML(basis)}</p><p>Regards,<br>School Attendance Office</p></td></tr></table></td></tr></table></body></html>`;
  return {
    subject: `${finalized ? "Attendance" : "DRAFT attendance"} | ${date}${scope === "all" ? "" : ` | ${scope}`}`,
    html,
    text,
  };
}
const base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let str = "";
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str);
};
export function mimeDraft(message: {
  subject: string;
  text: string;
  html: string;
}) {
  const boundary = "attend_" + crypto.randomUUID().replaceAll("-", "");
  const encoded = (s: string) =>
    (base64(s).match(/.{1,76}/g) || []).join("\r\n");
  return [
    `X-Unsent: 1`,
    `Subject: =?UTF-8?B?${base64(message.subject)}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded(message.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
