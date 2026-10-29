import { useState } from "react";
import {
  ArrowDownToLine,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  Image,
  Printer,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { Dataset } from "../types";
import type { Filters } from "../lib/analytics";
import {
  daily,
  enrollment,
  heatLevel,
  monthDays,
  risks,
  rollups,
  total,
  validSchoolDay,
} from "../lib/analytics";
import { briefing, mimeDraft } from "../lib/email";
export function download(value: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Kpis({
  data,
  date,
  filters,
}: {
  data: Dataset;
  date: string;
  filters: Filters;
}) {
  const stats = daily(data, date, filters),
    enrolled = enrollment(data, filters);
  return (
    <div className="kpis">
      {[
        {
          label: "Attendance rate",
          value: stats.rate === null ? "—" : stats.rate.toFixed(1) + "%",
          note: "Present ÷ recorded · 95% target",
          icon: CheckCircle2,
        },
        {
          label: "Present today",
          value: stats.present,
          note: `${stats.recorded} submitted attendance records`,
          icon: ShieldCheck,
        },
        {
          label: "Absent / excused",
          value: stats.absent + stats.excused + stats.leave,
          note: `${stats.absent} absent · ${stats.excused + stats.leave} excused / leave`,
          icon: TriangleAlert,
        },
        {
          label: "Roster coverage",
          value: enrolled
            ? `${Math.round((100 * stats.recorded) / enrolled)}%`
            : "—",
          note: `${stats.recorded} recorded / ${enrolled} on current roster`,
          icon: CalendarDays,
        },
      ].map(({ label, value, note, icon: Icon }) => (
        <article key={label} className="kpi">
          <div>
            <span>{label}</span>
            <Icon size={17} />
          </div>
          <strong>{value}</strong>
          <p>{note}</p>
        </article>
      ))}
    </div>
  );
}
export function DivisionTable({
  data,
  date,
  filters,
}: {
  data: Dataset;
  date: string;
  filters: Filters;
}) {
  const rows = rollups(data, date, filters);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Division snapshot</h2>
          <p>One daily picture, across your school.</p>
        </div>
        <span className="tag">{date}</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Division</th>
              <th>Recorded</th>
              <th>Present</th>
              <th>Absent</th>
              <th>Excused / leave</th>
              <th>Late / half-day</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = total(r);
              return (
                <tr key={r.division}>
                  <td>
                    <strong>{r.division}</strong>
                  </td>
                  {n < 5 ? (
                    <td colSpan={6} className="muted">
                      Details withheld · fewer than five students
                    </td>
                  ) : (
                    <>
                      <td>{n}</td>
                      <td>{r.present}</td>
                      <td>{r.absent}</td>
                      <td>{r.excused + r.leave}</td>
                      <td>
                        {r.late} / {r.half_day}
                      </td>
                      <td>
                        <span
                          className={`rate-label ${heatLevel((100 * r.present) / n)}`}
                        >
                          {((100 * r.present) / n).toFixed(1)}%
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No attendance has been submitted for this view and date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-footer">
        Rates use submitted records. Unmarked students are not assumed present.
        Leadership reports withhold divisions below five students.
      </div>
    </section>
  );
}
export function BoardReport({
  data,
  date,
  month,
  filters,
  onDate,
  executive,
  demo,
}: {
  data: Dataset;
  date: string;
  month: string;
  filters: Filters;
  onDate: (date: string) => void;
  executive: boolean;
  demo: boolean;
}) {
  const counts = daily(data, date, filters),
    enrolled = enrollment(data, filters),
    days = monthDays(month),
    risk = risks(data, date, filters),
    closed = new Map(data.calendar.map((d) => [d.date, d.label]));
  return (
    <section className="panel" id="board-report">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {demo
              ? "FICTIONAL DEMO · INSTITUTIONAL INTELLIGENCE"
              : "INSTITUTIONAL INTELLIGENCE"}
          </p>
          <h2>Monthly attendance health</h2>
          <p>
            {new Date(month + "-15T12:00:00Z").toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}{" "}
            ·{" "}
            {filters.division === "all" ? "School overview" : filters.division}
          </p>
        </div>
        <span className="target-pill">95% attendance target</span>
      </div>
      <div className="board-layout">
        <div className="heatmap">
          <div className="week-labels">
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {days.map((d, index) => {
              const stats = daily(data, d, filters),
                instructional = validSchoolDay(d, data.calendar),
                rate =
                  instructional && stats.recorded && enrolled
                    ? (100 * stats.present) / enrolled
                    : null,
                level = heatLevel(rate),
                suppressed = stats.recorded > 0 && stats.recorded < 5;
              return (
                <button
                  key={d}
                  style={
                    index === 0
                      ? {
                          gridColumnStart:
                            ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) +
                            1,
                        }
                      : undefined
                  }
                  className={`calendar-day ${!instructional ? "closed" : suppressed ? "none" : level} ${d === date ? "selected" : ""}`}
                  title={`${d}: ${closed.get(d) || (!instructional ? "Weekend" : suppressed ? "Details withheld" : rate === null ? "No submitted data / roster unavailable" : rate.toFixed(1) + "% · " + stats.recorded + " records")}`}
                  aria-label={`${d}: ${!instructional ? "Non-instructional" : suppressed ? "Details withheld" : rate === null ? "No data" : rate.toFixed(1) + " percent attendance"}`}
                  onClick={() => onDate(d)}
                >
                  <span>{Number(d.slice(-2))}</span>
                  <strong>
                    {!instructional
                      ? "—"
                      : suppressed
                        ? "Withheld"
                        : rate === null
                          ? "·"
                          : rate.toFixed(0) + "%"}
                  </strong>
                </button>
              );
            })}
          </div>
          <div className="heat-legend">
            <span>
              <i className="goal" />
              ≥95%
            </span>
            <span>
              <i className="normal" />
              90–94.9%
            </span>
            <span>
              <i className="warning" />
              85–89.9%
            </span>
            <span>
              <i className="critical" />
              &lt;85%
            </span>
            <span>
              <i className="none" />
              No data / closed
            </span>
          </div>
        </div>
        <aside className="board-summary">
          <span className="eyebrow">SELECTED DAY</span>
          <strong className="board-rate">
            {counts.rate === null ? "—" : counts.rate.toFixed(1) + "%"}
          </strong>
          <p>Present ÷ submitted records</p>
          <dl>
            <div>
              <dt>Current roster</dt>
              <dd>{enrolled}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{counts.recorded}</dd>
            </div>
            <div>
              <dt>Late arrivals</dt>
              <dd>{counts.late}</dd>
            </div>
            <div>
              <dt>Half-day</dt>
              <dd>{counts.half_day}</dd>
            </div>
            {!executive && (
              <div>
                <dt>Early warnings</dt>
                <dd>{risk.length}</dd>
              </div>
            )}
          </dl>
          <div className="board-note">
            <ShieldCheck size={17} />
            <p>
              Board exports contain division aggregates, never student names,
              registration numbers or staff notes.
            </p>
          </div>
        </aside>
      </div>
      <div className="panel-footer">
        Calendar = present ÷ current roster enrollment. Missing submissions
        lower coverage; no data stays neutral. Historical enrollment is not
        reconstructed. Non-instructional dates are neutral.
      </div>
    </section>
  );
}
export function RiskPanel({
  data,
  date,
  filters,
}: {
  data: Dataset;
  date: string;
  filters: Filters;
}) {
  const rows = risks(data, date, filters);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PASTORAL FOLLOW-UP · STAFF ONLY</p>
          <h2>Students to check in with</h2>
          <p>
            Below 90% present across recorded instructional days, or three
            consecutive unexplained absences.
          </p>
        </div>
        <span className="tag">{rows.length} flagged</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Registration</th>
              <th>Grade / house</th>
              <th>Present rate</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.student.student_code}>
                <td>
                  <strong>
                    {r.student.display_name || "Identity not entered"}
                  </strong>
                </td>
                <td className="mono">{r.student.registration_number || "—"}</td>
                <td>
                  {r.student.grade}
                  <small>{r.student.house || "Unassigned house"}</small>
                </td>
                <td>
                  {r.rate.toFixed(1)}%<small>{r.days} recorded days</small>
                </td>
                <td>
                  <span
                    className={`status-pill ${r.consecutive >= 3 ? "absent" : "late"}`}
                  >
                    {r.consecutive >= 3
                      ? `${r.consecutive} consecutive unexplained`
                      : "Attendance below 90%"}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No warning signals in the recorded data for this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-footer">
        Signals support a staff review; they are not findings of truancy or a
        diagnosis. Missing instructional dates break a consecutive-absence
        streak. Named follow-up lists are excluded from board exports.
      </div>
    </section>
  );
}
export function Reports({
  data,
  date,
  month,
  filters,
  demo,
  pending = 0,
}: {
  data: Dataset;
  date: string;
  month: string;
  filters: Filters;
  demo: boolean;
  pending?: number;
}) {
  const [scope, setScope] = useState("all"),
    [mode, setMode] = useState<"email" | "text">("email"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const generated = briefing(data, date, scope, filters);
  const message = {
    ...generated,
    text:
      (demo ? "FICTIONAL DEMO — NOT ACTUAL ATTENDANCE\n\n" : "") +
      generated.text,
    html: demo
      ? generated.html.replace(
          "</h1>",
          "</h1><p>FICTIONAL DEMO — NOT ACTUAL ATTENDANCE</p>",
        )
      : generated.html,
  };
  const prefix = demo ? "[FICTIONAL DEMO] " : "";
  const groups = rollups(data, date, filters).filter(
    (g) => scope === "all" || g.division === scope,
  );
  async function png() {
    setBusy("png");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const element = document.getElementById("board-report");
      if (!element) throw Error("Open the monthly report before exporting.");
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: "#ffffff",
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (blob) download(blob, `attendance-${month}.png`, "image/png");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function excel() {
    setBusy("xlsx");
    try {
      const { workbook } = await import("../lib/workbook");
      const rows: (string | number | null)[][] = [
        [
          "Date",
          "Division",
          "Recorded",
          "Present",
          "Absent",
          "Excused / leave",
          "Late",
          "Half-day",
          "Attendance rate",
        ],
      ];
      for (const r of groups) {
        const n = total(r);
        rows.push(
          n < 5
            ? [date, r.division, "Withheld (<5)"]
            : [
                date,
                r.division,
                n,
                r.present,
                r.absent,
                r.excused + r.leave,
                r.late,
                r.half_day,
                ((100 * r.present) / n).toFixed(1) + "%",
              ],
        );
      }
      const calendar: (string | number | null)[][] = [
        [
          "Date",
          "Instructional",
          "Current roster",
          "Submitted",
          "Present",
          "Present / enrollment",
        ],
      ];
      for (const d of monthDays(month)) {
        const exportFilters = {
          ...filters,
          ...(scope === "all" ? {} : { division: scope }),
        };
        const s = daily(data, d, exportFilters),
          n = enrollment(data, exportFilters);
        calendar.push(
          s.recorded > 0 && s.recorded < 5
            ? [d, "Details withheld"]
            : [
                d,
                validSchoolDay(d, data.calendar) ? "Yes" : "No",
                n,
                s.recorded,
                s.present,
                n && s.recorded
                  ? ((100 * s.present) / n).toFixed(1) + "%"
                  : null,
              ],
        );
      }
      const bytes = workbook([
        { name: "Division summary", rows },
        { name: "Monthly attendance", rows: calendar },
        {
          name: "Reporting basis",
          rows: [
            ["Fictional demo", demo ? "Yes" : "No"],
            [
              "Privacy",
              "Aggregates only. No student identities, reason descriptions, or staff notes.",
            ],
            [
              "Basis",
              "Daily rate = present / submitted; calendar = present / current roster.",
            ],
          ],
        },
      ]);
      download(
        bytes,
        `attendance-board-${month}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel reports-panel" id="leadership-report">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">LEADERSHIP COMMUNICATION</p>
          <h2>A briefing, ready for review.</h2>
          <p>
            Outlook-compatible HTML and multipart email drafts. Nothing is sent
            automatically.
          </p>
        </div>
        <label className="compact">
          Division scope
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All visible divisions</option>
            {groups.map((g) => (
              <option key={g.division}>{g.division}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="panel-body">
        <div className="report-toolbar">
          <div className="segmented">
            <button
              aria-pressed={mode === "email"}
              onClick={() => setMode("email")}
            >
              Email preview
            </button>
            <button
              aria-pressed={mode === "text"}
              onClick={() => setMode("text")}
            >
              Plain text
            </button>
          </div>
          <span className="muted small">
            Draft for manual review and sending
          </span>
        </div>
        <div className="subject-line">
          <span>SUBJECT</span>
          {prefix + message.subject}
        </div>
        {mode === "email" ? (
          <iframe
            title="Leadership email preview"
            className="email-preview"
            sandbox=""
            srcDoc={message.html}
          />
        ) : (
          <textarea
            className="text-preview"
            readOnly
            value={message.text}
            aria-label="Leadership briefing text"
          />
        )}
        {pending > 0 && (
          <p className="inline-warning">
            Save or discard pending attendance before exporting.
          </p>
        )}
        <div className="export-toolbar">
          <button
            disabled={pending > 0}
            className="button primary"
            onClick={() =>
              download(
                mimeDraft({ ...message, subject: prefix + message.subject }),
                `attendance-${date}.eml`,
                "message/rfc822",
              )
            }
          >
            <ArrowDownToLine size={16} />
            Outlook draft (.eml)
          </button>
          <button
            className="button secondary"
            disabled={pending > 0}
            onClick={() =>
              download(message.html, `attendance-${date}.html`, "text/html")
            }
          >
            HTML email
          </button>
          <button
            className="button secondary"
            disabled={pending > 0}
            onClick={() => window.print()}
          >
            <Printer size={15} />
            Print / PDF
          </button>
          <button
            className="button secondary"
            disabled={!!busy || pending > 0}
            onClick={() => void png()}
          >
            <Image size={15} />
            {busy === "png" ? "Preparing…" : "Board PNG"}
          </button>
          <button
            className="button secondary"
            disabled={!!busy || pending > 0}
            onClick={() => void excel()}
          >
            <FileSpreadsheet size={15} />
            {busy === "xlsx" ? "Preparing…" : "Excel"}
          </button>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <p className="field-note">
          EML includes plain-text and HTML alternatives. Rendering in specific
          Outlook versions still needs school-client acceptance testing.
          Print/PDF and PNG capture the monthly dashboard under its filters; the
          email division selector applies to HTML/EML and Excel.
        </p>
      </div>
    </section>
  );
}
