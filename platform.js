import { divisionForGrade, schoolDivisions } from "./src/students.js";
import { aggregateAttendance } from "./src/entry.js";
export const personas = ["secretary", "teacher", "division", "executive"];
export function migratePlatform(db) {
  const add = (table, column, type) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  for (const c of ["persona", "scope_division", "assigned_class"])
    add("users", c, "TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE users SET persona='secretary' WHERE persona=''");
  for (const c of ["class_name", "house"]) {
    add("roster", c, "TEXT NOT NULL DEFAULT ''");
    add("attendance", c, "TEXT NOT NULL DEFAULT ''");
  }
  for (const c of ["arrival_time"])
    add("attendance", c, "TEXT NOT NULL DEFAULT ''");
  add("attendance", "parent_notified", "INTEGER NOT NULL DEFAULT 0");
  for (const c of ["excused", "half_day"])
    add("grade_totals", c, "INTEGER NOT NULL DEFAULT 0");
  db.exec(`CREATE TABLE IF NOT EXISTS daily_register(date TEXT NOT NULL,grade TEXT NOT NULL,finalized_by INTEGER NOT NULL REFERENCES users(id),finalized_at TEXT NOT NULL,PRIMARY KEY(date,grade));
 CREATE TABLE IF NOT EXISTS attendance_events(id INTEGER PRIMARY KEY,date TEXT NOT NULL,student_code TEXT NOT NULL,old_status TEXT,new_status TEXT,actor INTEGER NOT NULL REFERENCES users(id),recorded_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS school_calendar(date TEXT PRIMARY KEY,label TEXT NOT NULL);`);
}
export function publicUser(u) {
  return u
    ? {
        id: u.id,
        username: u.username,
        role: u.role,
        persona: u.persona || "secretary",
        scope_division: u.scope_division || "",
        assigned_class: u.assigned_class || "",
      }
    : null;
}
export function readable(user, student) {
  if (user.role === "admin" || user.persona === "secretary") return true;
  if (user.persona === "teacher")
    return !!user.assigned_class && student?.class_name === user.assigned_class;
  if (user.persona === "division")
    return (
      !!user.scope_division &&
      divisionForGrade(student?.grade) === user.scope_division
    );
  return false;
}
export function writable(user) {
  return (
    user.role === "admin" || ["secretary", "teacher"].includes(user.persona)
  );
}
export function registrar(user) {
  return user.role === "admin" || user.persona === "secretary";
}
export function locked(db, date, grade) {
  return !!db
    .prepare("SELECT 1 FROM daily_register WHERE date=? AND grade=?")
    .get(date || "", grade || "");
}
export function dashboardData(db, user) {
  const allRoster = db
    .prepare(
      "SELECT student_code,grade,display_name,registration_number,class_name,house FROM roster ORDER BY display_name,registration_number,student_code",
    )
    .all();
  const allRecords = db
    .prepare(
      "SELECT date,student_code,grade,division,status,reason,note,parent_notified,arrival_time,class_name,house FROM attendance ORDER BY date,student_code",
    )
    .all()
    .map(
      ({
        reason,
        note,
        parent_notified,
        arrival_time,
        class_name,
        house,
        ...r
      }) => ({
        ...r,
        ...(reason ? { reason } : {}),
        ...(note ? { note } : {}),
        ...(parent_notified ? { parent_notified: true } : {}),
        ...(arrival_time ? { arrival_time } : {}),
        ...(class_name ? { class_name } : {}),
        ...(house ? { house } : {}),
      }),
    );
  const allTotals = db
    .prepare(
      "SELECT date,grade,total,present,absent,leave,late,excused,half_day FROM grade_totals ORDER BY date,grade",
    )
    .all();
  const dates = [
    ...new Set([...allRecords, ...allTotals].map((r) => r.date)),
  ].sort();
  const metrics = dates.flatMap((date) =>
    aggregateAttendance(allRecords, allTotals, date).map((d) => ({
      ...d,
      date,
    })),
  );
  const enrollment = schoolDivisions.map((division) => ({
    division,
    total: allRoster.filter((s) => divisionForGrade(s.grade) === division)
      .length,
  }));
  const executive = user.role !== "admin" && user.persona === "executive";
  const roster = executive ? [] : allRoster.filter((s) => readable(user, s));
  const codes = new Set(roster.map((s) => s.student_code));
  const records = executive
    ? []
    : allRecords.filter((r) => codes.has(r.student_code));
  const gradeAllowed = (grade) =>
    user.role === "admin" ||
    user.persona === "secretary" ||
    (user.persona === "division" &&
      divisionForGrade(grade) === user.scope_division);
  const totals = executive
    ? []
    : allTotals.filter((t) => gradeAllowed(t.grade));
  return {
    expectedGrades: [
      ...new Set([
        ...allRoster
          .filter((s) => executive || readable(user, s))
          .map((s) => s.grade),
        ...allTotals
          .filter((t) => executive || gradeAllowed(t.grade))
          .map((t) => t.grade),
      ]),
    ],
    records,
    totals,
    roster,
    metrics:
      executive || user.role === "admin" || user.persona === "secretary"
        ? metrics
        : user.persona === "division"
          ? metrics.filter((m) => m.division === user.scope_division)
          : [],
    enrollment:
      executive || user.role === "admin" || user.persona === "secretary"
        ? enrollment
        : user.persona === "division"
          ? enrollment.filter((e) => e.division === user.scope_division)
          : [],
    finalized: db
      .prepare(
        "SELECT date,grade,finalized_at,finalized_by FROM daily_register ORDER BY date,grade",
      )
      .all()
      .filter(
        (r) =>
          executive ||
          gradeAllowed(r.grade) ||
          roster.some((s) => s.grade === r.grade),
      ),
    calendar: db
      .prepare("SELECT date,label FROM school_calendar ORDER BY date")
      .all(),
    recordMeta: executive
      ? []
      : db
          .prepare(
            "SELECT date,student_code,updated_by AS recordedBy,updated_at AS recordedAt FROM attendance",
          )
          .all()
          .filter((r) => codes.has(r.student_code)),
    serverTime: new Date().toISOString(),
  };
}
export function platformRoute({ db, user, path, method, body, send, audit }) {
  if (path === "/api/finalize" && method === "POST") {
    if (!registrar(user))
      return send(403, {
        error: "Only a secretary or administrator may finalize a register.",
      });
    if (
      typeof body.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      !Array.isArray(body.grades) ||
      !body.grades.length ||
      body.grades.some(
        (g) => typeof g !== "string" || !/^([1-9]|1[0-2])$/.test(g),
      )
    )
      return send(400, { error: "Choose a date and one or more grades." });
    for (const grade of body.grades) {
      const count = db
        .prepare("SELECT 1 FROM grade_totals WHERE date=? AND grade=?")
        .get(body.date, grade);
      if (!count) {
        const entered = db
          .prepare(
            "SELECT COUNT(*) AS n FROM attendance WHERE date=? AND grade=?",
          )
          .get(body.date, grade).n;
        const missing = db
          .prepare(
            "SELECT COUNT(*) AS n FROM roster r WHERE r.grade=? AND NOT EXISTS(SELECT 1 FROM attendance a WHERE a.student_code=r.student_code AND a.date=? AND a.grade=?)",
          )
          .get(grade, body.date, grade).n;
        if (!entered || missing)
          return send(409, {
            error: `Grade ${grade} has unrecorded students or no attendance. Complete the register before finalizing.`,
          });
      }
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const grade of new Set(body.grades))
        db.prepare("INSERT OR IGNORE INTO daily_register VALUES(?,?,?,?)").run(
          body.date,
          grade,
          user.id,
          new Date().toISOString(),
        );
      audit(user.id, "register_finalized", body.grades.length);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return send(200, { ok: true });
  }
  if (path === "/api/finalize" && method === "DELETE") {
    if (user.role !== "admin")
      return send(403, {
        error: "Only an administrator can reopen a finalized register.",
      });
    if (typeof body.date !== "string" || typeof body.grade !== "string")
      return send(400, { error: "Choose a date and grade." });
    db.prepare("DELETE FROM daily_register WHERE date=? AND grade=?").run(
      body.date,
      body.grade,
    );
    audit(user.id, "register_reopened");
    return send(200, { ok: true });
  }
  if (path === "/api/access" && method === "PATCH") {
    if (user.role !== "admin")
      return send(403, { error: "Administrator access required." });
    if (!Number.isSafeInteger(body.id) || !personas.includes(body.persona))
      return send(400, { error: "Choose a staff account and supported role." });
    if (body.id === user.id)
      return send(400, {
        error: "Keep your administrator access; assign another account.",
      });
    const division =
      typeof body.scope_division === "string" ? body.scope_division : "";
    const assigned =
      typeof body.assigned_class === "string" ? body.assigned_class.trim() : "";
    if (
      (body.persona === "division" && !schoolDivisions.includes(division)) ||
      (body.persona === "teacher" &&
        (!assigned || assigned.length > 60 || /[\x00-\x1f<>]/.test(assigned)))
    )
      return send(400, {
        error:
          "Division heads need a division; teachers need an assigned class.",
      });
    const target = db
      .prepare("SELECT id,role FROM users WHERE id=?")
      .get(body.id);
    if (!target || target.role === "admin")
      return send(400, { error: "Choose a staff account." });
    db.prepare(
      "UPDATE users SET persona=?,scope_division=?,assigned_class=? WHERE id=?",
    ).run(
      body.persona,
      body.persona === "division" ? division : "",
      body.persona === "teacher" ? assigned : "",
      body.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(body.id);
    audit(user.id, "access_scope_updated");
    return send(200, { ok: true });
  }
  if (path === "/api/calendar" && method === "POST") {
    if (user.role !== "admin")
      return send(403, { error: "Administrator access required." });
    if (
      typeof body.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      !Number.isFinite(Date.parse(body.date)) ||
      new Date(body.date).toISOString().slice(0, 10) !== body.date ||
      typeof body.label !== "string" ||
      !body.label.trim() ||
      body.label.length > 80
    )
      return send(400, {
        error: "Choose a valid non-instructional date and label.",
      });
    db.prepare(
      "INSERT INTO school_calendar VALUES(?,?) ON CONFLICT(date) DO UPDATE SET label=excluded.label",
    ).run(body.date, body.label.trim());
    audit(user.id, "calendar_updated");
    return send(200, { ok: true });
  }
  if (path === "/api/audit" && method === "GET") {
    if (user.role !== "admin")
      return send(403, { error: "Administrator access required." });
    return send(200, {
      events: db
        .prepare(
          "SELECT id,date,student_code,old_status,new_status,actor,recorded_at FROM attendance_events ORDER BY id DESC LIMIT 200",
        )
        .all(),
    });
  }
  return false;
}
