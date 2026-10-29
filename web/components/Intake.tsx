import { useState } from "react";
import {
  Check,
  Clock,
  FileCheck2,
  Plus,
  Search,
  Upload,
  Users,
} from "lucide-react";
import type { Platform } from "../usePlatform";
import type { Attendance, Student, Status, Totals } from "../types";
import { labels, statuses, reasons } from "../types";
import { makeRecord } from "../lib/analytics";
import { Modal } from "./Modal";
import {
  parseRosterCSV,
  validateRosterStudent,
  importStudents,
  schoolDivisions,
} from "../../src/students.js";
import type { Filters } from "../lib/analytics";
import { matching } from "../lib/analytics";
export function RecordModal({
  student,
  status,
  existing,
  date,
  onClose,
  onSave,
}: {
  student: Student;
  status: Status;
  existing?: Attendance;
  date: string;
  onClose: () => void;
  onSave: (rows: Attendance[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(status),
    [reason, setReason] = useState(existing?.reason || "unexplained"),
    [note, setNote] = useState(existing?.note || ""),
    [notified, setNotified] = useState(existing?.parent_notified || false),
    [arrival, setArrival] = useState(
      existing?.arrival_time || new Date().toTimeString().slice(0, 5),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={selected === "late" ? "Log a late arrival" : "Record attendance"}
      onClose={onClose}
    >
      <div className="student-banner">
        <div className="avatar">{student.display_name?.slice(0, 1) || "S"}</div>
        <div>
          <strong>{student.display_name || "Identity not entered"}</strong>
          <p>
            {student.registration_number || student.student_code} · Grade{" "}
            {student.grade} · {student.class_name || "Class unassigned"}
          </p>
        </div>
        <span>{date}</span>
      </div>
      <form
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave([
              {
                ...makeRecord(student, date, selected),
                ...(selected !== "present" && selected !== "late"
                  ? { reason, note }
                  : {}),
                ...(selected === "late" ? { arrival_time: arrival, note } : {}),
                parent_notified: notified,
              },
            ]);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Status
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value as Status)}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        {selected === "late" ? (
          <>
            <label>
              Arrival time
              <input
                type="time"
                value={arrival}
                onChange={(e) => setArrival(e.target.value)}
                required
              />
            </label>
            <label>
              Staff note · optional
              <textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </>
        ) : (
          selected !== "present" && (
            <>
              <label>
                Absence reason
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {Object.entries(reasons).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Staff note <span className="muted">· optional</span>
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Brief context for attendance follow-up"
                />
              </label>
              <p className="field-note">
                Staff-only. Names, registration numbers and notes are excluded
                from leadership reports.
              </p>
            </>
          )
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={notified}
            onChange={(e) => setNotified(e.target.checked)}
          />
          Parent / guardian contact confirmed
        </label>
        <p className="field-note">
          Records a contact you have already made. No email, SMS or WhatsApp
          message is sent.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save attendance"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function RosterModal({
  grade,
  onClose,
  platform,
}: {
  grade: string;
  onClose: () => void;
  platform: Platform;
}) {
  const [name, setName] = useState(""),
    [registration, setRegistration] = useState(""),
    [className, setClass] = useState(`${grade}-A`),
    [house, setHouse] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="Add a student to the roster" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const student = validateRosterStudent({
              display_name: name,
              registration_number: registration,
              grade,
              class_name: className,
              house,
            });
            await platform.saveRoster([student as Student]);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="form-grid">
          <label>
            First name + last initial
            <input
              required
              maxLength={65}
              placeholder="Ava R."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Registration number
            <input
              required
              maxLength={40}
              placeholder="000123"
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
            />
          </label>
          <label>
            Homeroom class
            <input
              maxLength={60}
              value={className}
              onChange={(e) => setClass(e.target.value)}
            />
          </label>
          <label>
            House / pastoral group
            <input
              maxLength={60}
              value={house}
              onChange={(e) => setHouse(e.target.value)}
            />
          </label>
        </div>
        <p className="field-note">
          Grade {grade}. Registration numbers remain text. Reusing a
          registration number updates the existing student.
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save student</button>
        </div>
      </form>
    </Modal>
  );
}
function CountsForm({
  platform,
  grade,
  date,
  locked,
}: {
  platform: Platform;
  grade: string;
  date: string;
  locked: boolean;
}) {
  const saved = platform.data.totals.find(
    (t) => t.grade === grade && t.date === date,
  );
  const [values, setValues] = useState({
      total: saved?.total || 0,
      absent: saved?.absent || 0,
      leave: saved?.leave || 0,
      late: saved?.late || 0,
      excused: saved?.excused || 0,
      half_day: saved?.half_day || 0,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const entered = platform.data.records.some(
    (r) => r.grade === grade && r.date === date,
  );
  const present =
    values.total -
    values.absent -
    values.leave -
    values.late -
    values.excused -
    values.half_day;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (present < 0 || values.total < 1) {
          setError(
            "Enter a headcount greater than zero and exception counts within that total.",
          );
          return;
        }
        setBusy(true);
        try {
          await platform.saveTotals({
            ...values,
            present,
            date,
            grade,
          } as Totals);
          platform.setNotice(
            "Grade counts saved. Division reporting is updated.",
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        Counts support reporting; individual student histories and muster lists
        require the student register.
      </p>
      {entered && (
        <p className="inline-warning">
          Individual records already exist for this grade/date. Complete that
          register instead.
        </p>
      )}
      <div className="counts-grid">
        {Object.entries(values).map(([key, value]) => (
          <label key={key}>
            {key === "total" ? "Student count" : labels[key as Status]}
            <input
              type="number"
              min={key === "total" ? 1 : 0}
              max={10000}
              step={1}
              required
              value={value}
              disabled={entered || locked}
              onChange={(e) =>
                setValues({ ...values, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <div className="counts-footer">
        <span>
          Calculated present <strong>{present < 0 ? "—" : present}</strong>
        </span>
        {saved && !locked && (
          <button
            className="button secondary"
            type="button"
            onClick={async () => {
              if (
                confirm(
                  "Clear these saved counts to switch to individual marking?",
                )
              ) {
                try {
                  await platform.clearTotals(grade);
                } catch (e) {
                  setError((e as Error).message);
                  return;
                }
                platform.setNotice(
                  "Counts cleared. Individual marking is available.",
                );
              }
            }}
          >
            Clear saved counts
          </button>
        )}
        <button className="button primary" disabled={entered || locked || busy}>
          Save grade counts
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
export function Intake({
  platform,
  date,
  filters,
  teacher,
  onRecord,
}: {
  platform: Platform;
  date: string;
  filters: Filters;
  teacher: boolean;
  onRecord: (student: Student, status: Status) => void;
}) {
  const [grade, setGrade] = useState("2"),
    [tab, setTab] = useState<"individual" | "counts">("individual"),
    [query, setQuery] = useState(""),
    [add, setAdd] = useState(false),
    [history, setHistory] = useState<Student | null>(null),
    [error, setError] = useState("");
  const students = platform.data.roster
    .filter((s) => matching(s, filters) && (teacher || s.grade === grade))
    .filter((s) =>
      [s.display_name, s.registration_number, s.student_code].some((v) =>
        v?.toLowerCase().includes(query.toLowerCase()),
      ),
    );
  const byCode = new Map(
    platform.data.records
      .filter((r) => r.date === date)
      .map((r) => [r.student_code, r]),
  );
  const countGrade = platform.data.totals.some(
    (t) => t.grade === grade && t.date === date,
  );
  const lockedGrade = platform.data.finalized.some(
    (f) => f.date === date && f.grade === grade,
  );
  const isLocked = (s: Student) =>
    platform.data.finalized.some(
      (f) => f.date === date && f.grade === s.grade,
    ) ||
    platform.data.totals.some((t) => t.date === date && t.grade === s.grade);
  const unmarked = students.filter(
    (s) => !byCode.has(s.student_code) && !isLocked(s),
  );
  const marked = students.filter((s) => byCode.has(s.student_code)).length;
  async function importFile(file: File, roster: boolean) {
    try {
      if (platform.demo)
        throw Error(
          "Use fictional manual entries in the demo. Sign in before importing school files.",
        );
      if (file.size > 5_000_000)
        throw Error("Files must be smaller than 5 MB.");
      if (!file.name.toLowerCase().endsWith(".csv"))
        throw Error("Export the workbook as CSV first.");
      const text = await file.text();
      if (roster) await platform.saveRoster(parseRosterCSV(text) as Student[]);
      else
        await platform.save(
          importStudents(text, schoolDivisions) as Attendance[],
        );
      platform.setNotice(
        "Validated data imported. Unrecognized extra columns were discarded.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {teacher ? "CLASSROOM ROLL CALL" : "MORNING INTAKE"}
          </p>
          <h2>
            {teacher
              ? "Your classroom, accounted for."
              : "Secretary attendance desk"}
          </h2>
          <p>
            {teacher
              ? "Mark the remaining students present, then record exceptions."
              : "Choose a grade and enter counts or mark individual students."}
          </p>
        </div>
        {!teacher && (
          <label className="compact">
            Grade
            <select
              aria-label="Secretary grade"
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value);
                setError("");
              }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!teacher && (
        <div className="tabs">
          <button
            aria-pressed={tab === "individual"}
            onClick={() => setTab("individual")}
          >
            <Users size={15} />
            Individual students
          </button>
          <button
            aria-pressed={tab === "counts"}
            onClick={() => setTab("counts")}
          >
            <FileCheck2 size={15} />
            Grade counts
          </button>
        </div>
      )}
      <div className="panel-body">
        {(countGrade || lockedGrade) && !teacher && (
          <div className="inline-warning">
            {lockedGrade
              ? "This grade register is finalized."
              : "Saved grade counts are in use. Clear them in the counts tab before marking individual students."}
            {lockedGrade &&
              (platform.demo || platform.session?.user?.role === "admin") && (
                <button
                  className="text-button"
                  onClick={() =>
                    void platform
                      .reopen(grade)
                      .catch((e) => platform.setError(e.message))
                  }
                >
                  Reopen grade {grade}
                </button>
              )}
          </div>
        )}
        {tab === "counts" && !teacher ? (
          <CountsForm
            key={grade + date + String(countGrade)}
            platform={platform}
            grade={grade}
            date={date}
            locked={lockedGrade}
          />
        ) : (
          <>
            <div className="roster-toolbar">
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search student register"
                  placeholder="Find a name or registration number"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <span className="muted small">
                {marked} / {students.length} recorded
              </span>
              <button
                className="button secondary"
                disabled={!unmarked.length}
                onClick={() => {
                  if (
                    confirm(
                      `Mark ${unmarked.length} unrecorded students present? Existing exceptions stay unchanged.`,
                    )
                  )
                    void platform
                      .save(unmarked.map((s) => makeRecord(s, date, "present")))
                      .catch((e) => platform.setError(e.message));
                }}
              >
                <Check size={15} />
                Mark unmarked present
              </button>
              {!teacher && (
                <button className="button primary" onClick={() => setAdd(true)}>
                  <Plus size={15} />
                  Add student
                </button>
              )}
            </div>
            <div className="table-scroll roster-table">
              <table>
                <thead>
                  <tr>
                    <th>First name + last initial</th>
                    <th>Registration no.</th>
                    <th>Class / house</th>
                    <th>Status</th>
                    <th>Staff follow-up</th>
                    <th>Mark attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const r = byCode.get(s.student_code),
                      locked = isLocked(s);
                    return (
                      <tr key={s.student_code}>
                        <td>
                          <button
                            className="student-name"
                            onClick={() => setHistory(s)}
                          >
                            {s.display_name || "Identity not entered"}
                          </button>
                          <small>Grade {s.grade}</small>
                        </td>
                        <td className="mono">
                          {s.registration_number || s.student_code}
                        </td>
                        <td>
                          {s.class_name || "Unassigned"}
                          <small>{s.house || "No house assigned"}</small>
                        </td>
                        <td>
                          <button
                            className={`status-pill ${r?.status || "unmarked"}`}
                            disabled={locked}
                            onClick={() => onRecord(s, r?.status || "absent")}
                          >
                            {r ? labels[r.status] : "Not marked"}
                          </button>
                          {r?.arrival_time && (
                            <small>
                              <Clock size={10} />
                              {r.arrival_time}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className="follow-up">
                            {r?.reason ? reasons[r.reason] || r.reason : "—"}
                          </span>
                          {r?.note && (
                            <small className="staff-note">{r.note}</small>
                          )}
                          {r?.parent_notified && (
                            <small className="contact-confirmed">
                              Contact confirmed
                            </small>
                          )}
                        </td>
                        <td>
                          <div className="mark-actions">
                            <button
                              disabled={locked}
                              aria-label={`Mark ${s.display_name || s.registration_number} present`}
                              onClick={() =>
                                void platform
                                  .save([makeRecord(s, date, "present")])
                                  .catch((e) => platform.setError(e.message))
                              }
                            >
                              Present
                            </button>
                            <button
                              disabled={locked}
                              aria-label={`Mark ${s.display_name || s.registration_number} absent`}
                              onClick={() => onRecord(s, "absent")}
                            >
                              Absent
                            </button>
                            <button
                              disabled={locked}
                              aria-label={`Mark ${s.display_name || s.registration_number} late`}
                              onClick={() => onRecord(s, "late")}
                            >
                              Late
                            </button>
                            <select
                              disabled={locked}
                              aria-label={`More statuses for ${s.display_name || s.registration_number}`}
                              value=""
                              onChange={(e) =>
                                onRecord(s, e.target.value as Status)
                              }
                            >
                              <option value="" disabled>
                                More
                              </option>
                              <option value="excused">Excused</option>
                              <option value="half_day">Half-day</option>
                              <option value="leave">On leave</option>
                            </select>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!students.length && (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <Users size={26} />
                          <strong>No students in this view</strong>
                          <p>
                            {teacher
                              ? "An administrator must assign your class and enroll its students."
                              : "Add a student or import the staff roster to begin."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {!teacher && (
          <details className="imports">
            <summary>
              <Upload size={14} />
              Roster and attendance imports
            </summary>
            <div className="import-grid">
              <label>
                Staff roster CSV
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f, true);
                    e.target.value = "";
                  }}
                />
                <small>
                  display_name, registration_number, grade, class_name, house
                </small>
              </label>
              <label>
                Attendance CSV
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f, false);
                    e.target.value = "";
                  }}
                />
                <small>
                  date, student_code, grade, division, status; optional reason
                  and note
                </small>
              </label>
            </div>
            <p className="field-note">
              Names, registration numbers and staff notes are personal data and
              stay in the authenticated register. CSV/Excel exports for
              leadership are aggregate only.
            </p>
          </details>
        )}
      </div>
      {add && (
        <RosterModal
          grade={grade}
          platform={platform}
          onClose={() => setAdd(false)}
        />
      )}
      {history && (
        <Modal
          title="Student attendance history"
          onClose={() => setHistory(null)}
          wide
        >
          <div className="student-banner">
            <strong>{history.display_name || "Identity not entered"}</strong>
            <span>{history.registration_number || history.student_code}</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Reason / staff note</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {platform.data.records
                  .filter((r) => r.student_code === history.student_code)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((r) => {
                    const meta = platform.data.recordMeta.find(
                      (m) =>
                        m.student_code === r.student_code && m.date === r.date,
                    );
                    return (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td>{labels[r.status]}</td>
                        <td>
                          {reasons[r.reason || ""] || "—"}
                          <small className="staff-note">{r.note}</small>
                        </td>
                        <td>
                          {meta ? `Staff #${meta.recordedBy}` : "Demo"}
                          <small>
                            {meta?.recordedAt || "Fictional record"}
                          </small>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </section>
  );
}
