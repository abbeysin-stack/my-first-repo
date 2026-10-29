import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Command,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { usePlatform } from "./usePlatform";
import type { Attendance, Persona, Status, Student } from "./types";
import {
  emptyFilters,
  type Filters,
  matching,
  makeRecord,
} from "./lib/analytics";
import { schoolDivisions } from "../src/students.js";
import {
  Kpis,
  DivisionTable,
  BoardReport,
  RiskPanel,
  Reports,
} from "./components/Insights";
import { Intake, RecordModal } from "./components/Intake";
import { Modal } from "./components/Modal";
import { Settings } from "./components/Settings";
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const views: Record<
  Persona,
  { name: string; title: string; description: string; icon: typeof Users }
> = {
  secretary: {
    name: "Secretary",
    title: "A clear view of your school day.",
    description:
      "Fast intake. A complete register. A briefing ready for leadership.",
    icon: LayoutDashboard,
  },
  teacher: {
    name: "Teacher",
    title: "Every student, accounted for.",
    description: "A focused roll call for your assigned classroom.",
    icon: BookOpen,
  },
  division: {
    name: "Division head",
    title: "See the patterns. Act earlier.",
    description:
      "Grade-level health and student follow-up within your division.",
    icon: GraduationCap,
  },
  executive: {
    name: "Head of school",
    title: "The school day, in perspective.",
    description:
      "Institutional attendance, monthly trends, and board-ready reports.",
    icon: Activity,
  },
};
function fuzzy(value: string, query: string) {
  const a = value.toLowerCase(),
    b = query.toLowerCase();
  if (a.includes(b)) return true;
  let index = 0;
  for (const c of a) if (c === b[index]) index++;
  return index === b.length;
}
export default function App() {
  const [date, setDate] = useState(localDate),
    [month, setMonth] = useState(localDate().slice(0, 7)),
    [view, setView] = useState<Persona>("secretary"),
    [settings, setSettings] = useState(false),
    [filters, setFilters] = useState<Filters>(emptyFilters),
    [search, setSearch] = useState(false),
    [muster, setMuster] = useState(false),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<{
      student: Student;
      status: Status;
    } | null>(null),
    [loginName, setLoginName] = useState(""),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState(""),
    [loginBusy, setLoginBusy] = useState(false),
    [finalizeError, setFinalizeError] = useState("");
  const platform = usePlatform(date),
    user = platform.session?.user,
    administrator = platform.demo || user?.role === "admin",
    signedIn = platform.demo || !!user,
    allowed: Persona[] = administrator
      ? ["secretary", "teacher", "division", "executive"]
      : user
        ? [user.persona]
        : ["secretary"];
  useEffect(() => {
    if (user && !administrator) {
      setView(user.persona);
      setFilters({
        ...emptyFilters,
        ...(user.persona === "teacher"
          ? { class_name: user.assigned_class || "__unassigned__" }
          : {}),
        ...(user.persona === "division"
          ? { division: user.scope_division || "__unassigned__" }
          : {}),
      });
    }
  }, [
    user?.id,
    user?.persona,
    user?.assigned_class,
    user?.scope_division,
    administrator,
  ]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (signedIn) {
          setQuery("");
          setSearch(true);
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [signedIn]);
  useEffect(() => {
    if (!signedIn) {
      setSearch(false);
      setMuster(false);
      setEditing(null);
      setQuery("");
      setPassword("");
      setLoginName("");
    }
  }, [signedIn]);
  const searchIndex = useMemo(
    () =>
      platform.data.roster.map((student) => ({
        student,
        text: `${student.display_name || ""} ${student.registration_number || ""} ${student.student_code} ${student.class_name || ""}`,
      })),
    [platform.data.roster],
  );
  const results = useMemo(
    () => searchIndex.filter((s) => fuzzy(s.text, query)).slice(0, 40),
    [searchIndex, query],
  );
  const canEdit =
    administrator ||
    user?.persona === "secretary" ||
    user?.persona === "teacher";
  const effectiveFilters =
    view === "teacher" && administrator && filters.class_name === "all"
      ? {
          ...filters,
          class_name:
            platform.data.roster.find((s) => s.class_name)?.class_name || "all",
        }
      : filters;
  const classes = [
      ...new Set(platform.data.roster.map((s) => s.class_name).filter(Boolean)),
    ] as string[],
    houses = [
      ...new Set(platform.data.roster.map((s) => s.house).filter(Boolean)),
    ] as string[];
  const selectView = (next: Persona) => {
    if (!allowed.includes(next)) return;
    setSettings(false);
    setView(next);
    if (administrator)
      setFilters({
        ...emptyFilters,
        ...(next === "teacher"
          ? {
              class_name:
                platform.data.roster.find(
                  (s) =>
                    s.class_name &&
                    !platform.data.totals.some(
                      (t) => t.date === date && t.grade === s.grade,
                    ),
                )?.class_name ||
                classes[0] ||
                "all",
            }
          : {}),
      });
  };
  if (platform.busy)
    return (
      <div className="loading-screen">
        <span className="brand-symbol">◇</span>
        <h1>Opening your workspace…</h1>
      </div>
    );
  if (!signedIn)
    return (
      <main className="login-screen">
        <div className="login-visual">
          <div className="brand">
            <span>◇</span>attend<span className="brand-dot">.</span>
          </div>
          <div>
            <p className="eyebrow">YOUR SCHOOL. ONE DAILY PICTURE.</p>
            <h1>
              Less time compiling.
              <br />
              More time caring.
            </h1>
            <p>
              A connected attendance workspace, from the first roll call to the
              leadership briefing.
            </p>
            <div className="login-benefits">
              <span>
                <CheckCircle2 size={17} />
                Fast morning intake
              </span>
              <span>
                <CheckCircle2 size={17} />
                Role-scoped staff access
              </span>
              <span>
                <CheckCircle2 size={17} />
                Private, aggregate reporting
              </span>
            </div>
          </div>
          <small>BUILT FOR SCHOOL OPERATIONS</small>
        </div>
        <section className="login-card">
          <span className="eyebrow accent">STAFF WORKSPACE</span>
          <h2>Welcome to your school day.</h2>
          <p>Sign in with your assigned school account.</p>
          {platform.session?.authMode === "local" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoginBusy(true);
                setLoginError("");
                const secret = password;
                setPassword("");
                try {
                  await platform.login(loginName, secret);
                } catch (e) {
                  setLoginError((e as Error).message);
                } finally {
                  setLoginBusy(false);
                }
              }}
            >
              <label>
                Staff username
                <input
                  required
                  autoComplete="username"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  required
                  type="password"
                  minLength={platform.session.setupRequired ? 12 : 1}
                  maxLength={128}
                  autoComplete={
                    platform.session.setupRequired
                      ? "new-password"
                      : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="button primary full" disabled={loginBusy}>
                {platform.session.setupRequired
                  ? "Create local test administrator"
                  : "Sign in"}
              </button>
              <p className="field-note">
                Isolated development accounts only. School deployment uses
                Microsoft Entra.
              </p>
            </form>
          ) : (
            <>
              <a
                className={`button primary full ${!platform.session?.microsoftConfigured ? "disabled" : ""}`}
                href={
                  platform.session?.microsoftConfigured
                    ? "/auth/microsoft"
                    : undefined
                }
                aria-disabled={!platform.session?.microsoftConfigured}
              >
                <span className="microsoft-mark">▦</span>Continue with Microsoft
                <ArrowRight size={16} />
              </a>
              {!platform.session?.microsoftConfigured && (
                <p className="field-note">
                  School sign-in setup is pending. The fictional review
                  workspace is available below.
                </p>
              )}
            </>
          )}
          {(loginError || platform.error) && (
            <p role="alert" className="error-text">
              {loginError || platform.error}
            </p>
          )}
          <div className="login-divider">
            <span>REVIEW THE PLATFORM</span>
          </div>
          <button
            className="button secondary full"
            onClick={() => {
              platform.startDemo();
              setView("secretary");
              setFilters(emptyFilters);
            }}
          >
            Explore fictional demo
            <ArrowRight size={16} />
          </button>
          <p className="privacy-note">
            <ShieldCheck size={17} />
            Staff records contain personal data. Leadership exports exclude
            identities and written notes. No messages are sent automatically.
          </p>
        </section>
      </main>
    );
  const selectedView = views[view];
  const wholeSchoolGrades = [
    ...new Set([
      ...platform.data.roster.map((s) => s.grade),
      ...platform.data.totals
        .filter((t) => t.date === date)
        .map((t) => t.grade),
    ]),
  ];
  const finalized = platform.data.finalized.filter(
    (f) => f.date === date,
  ).length;
  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <a className="brand" href="#">
          <span>◇</span>attend<span className="brand-dot">.</span>
        </a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav>
          {allowed.map((role) => {
            const Icon = views[role].icon;
            return (
              <button
                key={role}
                className={view === role && !settings ? "active" : ""}
                onClick={() => selectView(role)}
              >
                <Icon size={18} />
                {views[role].name}
                <ChevronRight size={13} />
              </button>
            );
          })}
          {administrator && (
            <button
              className={settings ? "active" : ""}
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
              Administration
            </button>
          )}
        </nav>
        <div className="sidebar-help">
          <ShieldCheck size={28} />
          <strong>Privacy in every view.</strong>
          <p>
            Staff-only student details.
            <br />
            Aggregate leadership reports.
          </p>
          <span>
            {platform.demo
              ? "FICTIONAL REVIEW WORKSPACE"
              : "MICROSOFT SCHOOL ACCESS"}
          </span>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar no-print">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={12} />
            <span>{settings ? "Administration" : selectedView.name}</span>
          </div>
          <button
            className="global-search"
            onClick={() => {
              setQuery("");
              setSearch(true);
            }}
          >
            <Search size={15} />
            <span>Find a student</span>
            <kbd>
              <Command size={10} /> K
            </kbd>
          </button>
          {view !== "executive" && (
            <button
              className="button secondary muster-button"
              onClick={() => setMuster(true)}
            >
              Muster view
            </button>
          )}
          <div className="topbar-account">
            <span className="connection-dot" />
            {platform.demo
              ? "Fictional demo"
              : user?.role === "admin"
                ? "Administrator"
                : "School staff"}
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => void platform.logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <div className="page-heading no-print">
          <div>
            <p className="eyebrow accent">
              {settings
                ? "PLATFORM ADMINISTRATION"
                : "SCHOOL ATTENDANCE & OPERATIONS"}
            </p>
            <h1>
              {settings
                ? "The right access. The right context."
                : selectedView.title}
            </h1>
            <p>
              {settings
                ? "Staff assignments and instructional dates for your school."
                : selectedView.description}
            </p>
          </div>
          <label className="date-control">
            Reporting date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value);
                  setMonth(e.target.value.slice(0, 7));
                }
              }}
            />
          </label>
        </div>
        <div className="privacy-banner no-print">
          <ShieldCheck size={18} />
          <p>
            <strong>
              {platform.demo
                ? "Fictional data. Real workflows."
                : "Student details stay with authorized staff."}
            </strong>{" "}
            {platform.demo
              ? "Explore all four workspaces. Demo changes never enter the school database."
              : "Names, registration numbers and staff notes are excluded from leadership emails and board exports."}
          </p>
          <span className="live-label">
            {platform.pending ? <WifiOff size={14} /> : <Wifi size={14} />}
            {platform.pending
              ? `${platform.pending} pending`
              : platform.demo
                ? "DEMO"
                : `LIVE${platform.lastSync ? " · " + platform.lastSync : ""}`}
          </span>
        </div>
        {(platform.error || platform.notice) && (
          <div
            className={`feedback no-print ${platform.error ? "failure" : ""}`}
            role={platform.error ? "alert" : "status"}
          >
            <span>{platform.error || platform.notice}</span>
            {platform.pending > 0 && (
              <div>
                <button
                  className="text-button"
                  onClick={() => void platform.pump()}
                >
                  Retry
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      confirm(
                        "Discard unsaved changes and restore the server register?",
                      )
                    )
                      void platform.discard();
                  }}
                >
                  Discard pending
                </button>
              </div>
            )}
            <button
              aria-label="Dismiss message"
              className="icon-button"
              onClick={() => {
                platform.setError("");
                platform.setNotice("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {settings ? (
          <Settings platform={platform} />
        ) : (
          <>
            <div className="filter-bar no-print">
              <label>
                Division
                <select
                  disabled={!administrator && user?.persona === "division"}
                  value={effectiveFilters.division}
                  onChange={(e) =>
                    setFilters({ ...filters, division: e.target.value })
                  }
                >
                  <option value="all">All visible divisions</option>
                  {schoolDivisions.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              {view !== "executive" && (
                <>
                  <label>
                    Grade
                    <select
                      value={effectiveFilters.grade}
                      onChange={(e) =>
                        setFilters({ ...filters, grade: e.target.value })
                      }
                    >
                      <option value="all">All grades</option>
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Class
                    <select
                      disabled={!administrator && user?.persona === "teacher"}
                      value={effectiveFilters.class_name}
                      onChange={(e) =>
                        setFilters({ ...filters, class_name: e.target.value })
                      }
                    >
                      <option value="all">All classes</option>
                      {classes.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    House
                    <select
                      value={effectiveFilters.house}
                      onChange={(e) =>
                        setFilters({ ...filters, house: e.target.value })
                      }
                    >
                      <option value="all">All houses</option>
                      {houses.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label className="month-control">
                Report month
                <input
                  type="month"
                  value={month}
                  onChange={(e) => {
                    if (e.target.value) setMonth(e.target.value);
                  }}
                />
              </label>
            </div>
            {(filters.class_name !== "all" || filters.house !== "all") && (
              <p className="filter-note no-print">
                Class / house filters use individual records only. Grade totals
                cannot be attributed to individual houses or classes.
              </p>
            )}
            <Kpis data={platform.data} date={date} filters={effectiveFilters} />
            {(view === "secretary" || view === "teacher") && (
              <Intake
                platform={platform}
                date={date}
                filters={effectiveFilters}
                teacher={view === "teacher"}
                onRecord={(student, status) => setEditing({ student, status })}
              />
            )}
            {view !== "teacher" && (
              <>
                <DivisionTable
                  data={platform.data}
                  date={date}
                  filters={effectiveFilters}
                />
                {view === "secretary" && (
                  <section className="certification no-print">
                    <div>
                      <FileCheckIcon />
                      <div>
                        <h3>Verify the morning register</h3>
                        <p>
                          {finalized} grade registers finalized for {date}.
                          Finalization locks attendance until an administrator
                          reopens it.
                        </p>
                      </div>
                    </div>
                    <button
                      className="button primary"
                      disabled={
                        !wholeSchoolGrades.length || platform.pending > 0
                      }
                      onClick={async () => {
                        setFinalizeError("");
                        if (
                          !confirm(
                            "Finalize all enrolled grades in your authorized school workspace for this date? Every student must be marked or the grade must use saved counts.",
                          )
                        )
                          return;
                        try {
                          await platform.finalize(wholeSchoolGrades);
                          platform.setNotice(
                            "Visible grade registers finalized. Review the generated briefing before sending.",
                          );
                        } catch (e) {
                          setFinalizeError((e as Error).message);
                        }
                      }}
                    >
                      Verify & finalize
                    </button>
                    {finalizeError && (
                      <p role="alert" className="error-text">
                        {finalizeError}
                      </p>
                    )}
                  </section>
                )}
                <BoardReport
                  data={platform.data}
                  date={date}
                  month={month}
                  filters={effectiveFilters}
                  onDate={setDate}
                  executive={view === "executive"}
                  demo={platform.demo}
                />
                {view === "division" && (
                  <RiskPanel
                    data={platform.data}
                    date={date}
                    filters={effectiveFilters}
                  />
                )}
                <Reports
                  data={platform.data}
                  date={date}
                  month={month}
                  filters={effectiveFilters}
                  demo={platform.demo}
                  pending={platform.pending}
                />
              </>
            )}
          </>
        )}
        <footer className="app-footer no-print">
          <span>ATTEND · SCHOOL OPERATIONS</span>
          <p>
            Staff records are personal data. In-memory pending edits are lost on
            reload; no student data is saved to local storage. A finalized
            register is not a live campus occupancy guarantee.
          </p>
        </footer>
      </main>
      {muster && (
        <Modal
          title="Attendance muster view"
          onClose={() => setMuster(false)}
          wide
        >
          <p className="inline-warning">
            {date} · This is the recorded attendance register, not a live campus
            occupancy system. Unmarked students and count-only grades need
            individual verification.
          </p>
          <div className="table-scroll muster-table">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Registration</th>
                  <th>Grade / class</th>
                  <th>Recorded status</th>
                </tr>
              </thead>
              <tbody>
                {platform.data.roster
                  .filter((s) => matching(s, effectiveFilters))
                  .map((s) => {
                    const record = platform.data.records.find(
                      (r) =>
                        r.date === date && r.student_code === s.student_code,
                    );
                    return (
                      <tr key={s.student_code}>
                        <td>{s.display_name || "Identity not entered"}</td>
                        <td>{s.registration_number || s.student_code}</td>
                        <td>
                          {s.grade} · {s.class_name || "Unassigned"}
                        </td>
                        <td>
                          {record
                            ? record.status === "half_day"
                              ? "Half-day — verify presence"
                              : record.status === "late"
                                ? "Arrived late"
                                : record.status
                            : "Not marked — verify"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      {search && (
        <Modal title="Find a student" onClose={() => setSearch(false)} wide>
          <div className="search-field search-modal-input">
            <Search size={20} />
            <input
              autoFocus
              value={query}
              aria-label="Search all authorized students"
              placeholder="Name, registration number, or class…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <p className="field-note">
            Only students authorized for your account are searchable.{" "}
            {canEdit
              ? "Select a student to record an absence or late arrival."
              : "This workspace has read-only access."}
          </p>
          <div className="search-results">
            {results.map(({ student }) => (
              <button
                key={student.student_code}
                disabled={!canEdit}
                onClick={() => {
                  setSearch(false);
                  setEditing({ student, status: "absent" });
                }}
              >
                <span className="avatar">
                  {student.display_name?.slice(0, 1) || "S"}
                </span>
                <span>
                  <strong>
                    {student.display_name || "Identity not entered"}
                  </strong>
                  <small>
                    {student.registration_number || student.student_code} ·
                    Grade {student.grade} ·{" "}
                    {student.class_name || "Unassigned class"}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!results.length && (
              <p className="empty-cell">
                No students match this search in your authorized roster.
              </p>
            )}
          </div>
        </Modal>
      )}
      {editing && canEdit && (
        <RecordModal
          student={editing.student}
          status={editing.status}
          existing={platform.data.records.find(
            (r) =>
              r.date === date &&
              r.student_code === editing.student.student_code,
          )}
          date={date}
          onClose={() => setEditing(null)}
          onSave={platform.save}
        />
      )}
    </div>
  );
}
function FileCheckIcon() {
  return <CheckCircle2 size={27} />;
}
