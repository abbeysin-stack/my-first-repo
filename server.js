import http from "node:http";
import { readFile, mkdir, chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMicrosoftAuth } from "./microsoft.js";
import {
  validateRecord,
  divisionForGrade,
  validateRosterStudent,
} from "./src/students.js";
import {
  migratePlatform,
  publicUser,
  readable,
  writable,
  registrar,
  locked,
  dashboardData,
  platformRoute,
} from "./platform.js";
import { validateTotals } from "./src/entry.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const passwordHash = (password, salt) =>
  scryptSync(password, salt, 64).toString("hex");
const routes = { "/": "dist/index.html" };
export async function createApp({
  dbPath = process.env.ATTENDANCE_DB_PATH ||
    resolve(".local/attendance.sqlite"),
  production = process.env.NODE_ENV === "production",
  appOrigin = process.env.APP_ORIGIN,
  allowSetup = process.env.ATTENDANCE_LOCAL_AUTH === "1",
  microsoftConfig,
  fetchImpl,
} = {}) {
  if (production && (!appOrigin || !appOrigin.startsWith("https://")))
    throw Error(
      "Production requires an HTTPS APP_ORIGIN and a trusted TLS reverse proxy.",
    );
  if (dbPath !== ":memory:") {
    await mkdir(resolve(dbPath, ".."), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','staff')),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attendance(date TEXT NOT NULL,student_code TEXT NOT NULL,grade TEXT NOT NULL,division TEXT NOT NULL,status TEXT NOT NULL,updated_by INTEGER NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL,PRIMARY KEY(date,student_code));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor INTEGER REFERENCES users(id),action TEXT NOT NULL,record_count INTEGER NOT NULL,created_at TEXT NOT NULL);`);
  if (
    !db
      .prepare("PRAGMA table_info(attendance)")
      .all()
      .some((c) => c.name === "reason")
  )
    db.exec(
      "ALTER TABLE attendance ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
    );
  if (
    !db
      .prepare("PRAGMA table_info(attendance)")
      .all()
      .some((c) => c.name === "note")
  )
    db.exec("ALTER TABLE attendance ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  db.exec(
    "UPDATE attendance SET reason='unexplained' WHERE status='absent' AND reason=''",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS roster(student_code TEXT PRIMARY KEY,grade TEXT NOT NULL,updated_by INTEGER REFERENCES users(id),updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS grade_totals(date TEXT NOT NULL,grade TEXT NOT NULL,total INTEGER NOT NULL,present INTEGER NOT NULL,absent INTEGER NOT NULL,leave INTEGER NOT NULL,late INTEGER NOT NULL,updated_by INTEGER NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL,PRIMARY KEY(date,grade));
    INSERT OR IGNORE INTO roster(student_code,grade,updated_at) SELECT a.student_code,a.grade,a.updated_at FROM attendance a WHERE a.date=(SELECT MAX(b.date) FROM attendance b WHERE b.student_code=a.student_code);`);
  for (const column of ["display_name", "registration_number"])
    if (
      !db
        .prepare("PRAGMA table_info(roster)")
        .all()
        .some((c) => c.name === column)
    )
      db.exec(
        `ALTER TABLE roster ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`,
      );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS roster_registration_unique ON roster(registration_number COLLATE NOCASE) WHERE registration_number<>''",
  );
  migratePlatform(db);
  if (dbPath !== ":memory:") await chmod(dbPath, 0o600);
  const microsoft = createMicrosoftAuth(
    microsoftConfig || {
      tenantId: process.env.MS_TENANT_ID,
      clientId: process.env.MS_CLIENT_ID,
      clientSecret: process.env.MS_CLIENT_SECRET,
      origin: appOrigin,
    },
    fetchImpl,
  );
  const localAuth = allowSetup && !microsoft.configured;
  const attempts = new Map();
  let setupConsumed = false;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
  if (production) headers["Strict-Transport-Security"] = "max-age=31536000";
  const getUserAfterLogin = (id) =>
    db
      .prepare(
        "SELECT id,username,role,COALESCE(NULLIF(persona,''),'secretary') AS persona,scope_division,assigned_class FROM users WHERE id=?",
      )
      .get(id);
  const streams = new Set();
  let revision = 0;
  const audit = (actor, action, count = 0) => {
    db.prepare(
      "INSERT INTO audit(actor,action,record_count,created_at) VALUES(?,?,?,?)",
    ).run(actor, action, count, new Date().toISOString());
    revision++;
    for (const res of streams) res.write(`data: ${revision}\n\n`);
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, data, extra = {}) => {
      res.writeHead(status, {
        ...headers,
        "Content-Type": "application/json",
        ...extra,
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      if (path === "/auth/microsoft" && req.method === "GET") {
        if (!microsoft.configured)
          return send(503, {
            error:
              "Microsoft sign-in is not configured. Ask your school administrator to complete deployment settings.",
          });
        const start = microsoft.begin();
        res.writeHead(302, {
          ...headers,
          Location: start.url,
          "Set-Cookie": `attendance_oauth=${start.binding}; HttpOnly; SameSite=Lax; Path=/auth/; Max-Age=600${production ? "; Secure" : ""}`,
        });
        return res.end();
      }
      if (path === "/auth/microsoft/callback" && req.method === "GET") {
        try {
          const binding = req.headers.cookie
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("attendance_oauth="))
            ?.slice("attendance_oauth=".length);
          const identity = await microsoft.complete(url.searchParams, binding);
          const username = "ms-" + identity.oid;
          let user = db
            .prepare("SELECT * FROM users WHERE username=?")
            .get(username);
          if (!user) {
            const salt = randomBytes(24).toString("hex");
            const result = db
              .prepare(
                "INSERT INTO users(username,password_hash,salt,role,created_at) VALUES(?,?,?,?,?)",
              )
              .run(
                username,
                passwordHash(randomBytes(32).toString("hex"), salt),
                salt,
                identity.role,
                new Date().toISOString(),
              );
            user = {
              id: Number(result.lastInsertRowid),
              username,
              role: identity.role,
            };
          } else {
            db.prepare("UPDATE users SET role=? WHERE id=?").run(
              identity.role,
              user.id,
            );
            user.role = identity.role;
          }
          if (identity.persona)
            db.prepare("UPDATE users SET persona=? WHERE id=?").run(
              identity.persona,
              user.id,
            );
          const token = randomBytes(32).toString("hex");
          db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
          db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
            hash(token),
            user.id,
            Date.now() + 8 * 3600000,
          );
          audit(user.id, "microsoft_login");
          res.writeHead(302, {
            ...headers,
            Location: "/",
            "Set-Cookie": [
              `attendance_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production ? "; Secure" : ""}`,
              `attendance_oauth=; HttpOnly; SameSite=Lax; Path=/auth/; Max-Age=0${production ? "; Secure" : ""}`,
            ],
          });
          return res.end();
        } catch {
          return send(401, {
            error:
              "Microsoft sign-in could not be completed. Check school account assignment, app roles, and configuration, then retry.",
          });
        }
      }
      if (!path.startsWith("/api/")) {
        const file =
          routes[path] ||
          (/^\/assets\/[a-zA-Z0-9._-]+\.(js|css)$/.test(path)
            ? "dist" + path
            : null);
        if (!["GET", "HEAD"].includes(req.method) || !file) {
          res.writeHead(404, headers);
          return res.end("Not found");
        }
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, {
          ...headers,
          "Content-Type": file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
        });
        return res.end(req.method === "HEAD" ? undefined : content);
      }
      // Browser mutations must originate from the configured application origin.
      if (!["GET", "HEAD"].includes(req.method)) {
        const expected = appOrigin || `http://${req.headers.host}`;
        if (
          req.headers.origin !== expected ||
          req.headers["content-type"]?.split(";")[0] !== "application/json"
        )
          return send(403, {
            error: "Request origin or content type is not permitted.",
          });
      }
      let body = {};
      if (!["GET", "HEAD"].includes(req.method)) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 5_000_000)
            return send(413, { error: "Request exceeds the 5 MB limit." });
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          return send(400, { error: "Invalid JSON request." });
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          return send(400, { error: "Invalid request object." });
      }
      const setupRequired = !db.prepare("SELECT 1 FROM users LIMIT 1").get();
      if (path === "/api/session" && req.method === "GET") {
        const user = getUser();
        return send(200, {
          setupRequired: localAuth && setupRequired,
          authMode: localAuth ? "local" : "microsoft",
          microsoftConfigured: microsoft.configured,
          user: publicUser(user),
        });
      }
      if (
        (path === "/api/setup" || path === "/api/login") &&
        req.method === "POST"
      ) {
        if (!localAuth)
          return send(403, { error: "Use Microsoft school sign-in." });
        const attemptKey = String(req.socket.remoteAddress);
        const attempt = attempts.get(attemptKey);
        const time = Date.now();
        if (attempt && attempt.until > time && attempt.count >= 10)
          return send(429, {
            error: "Too many sign-in attempts. Try again in 15 minutes.",
          });
        if (!attempt || attempt.until <= time)
          attempts.set(attemptKey, { count: 1, until: time + 900000 });
        else attempt.count++;
        const { username, password } = body;
        if (
          typeof username !== "string" ||
          typeof password !== "string" ||
          !/^[a-zA-Z0-9._-]{3,40}$/.test(username) ||
          password.length > 128
        )
          return send(400, {
            error: "Use a 3–40 character staff username and a valid password.",
          });
        let user;
        if (path === "/api/setup") {
          if (!localAuth || !setupRequired || setupConsumed)
            return send(403, {
              error: "Initial administrator setup is unavailable.",
            });
          // Initial setup is only available from loopback; public deployments must provision locally first.
          if (
            !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
              req.socket.remoteAddress,
            ) ||
            production
          )
            return send(403, {
              error:
                "Provision the initial administrator locally before production deployment.",
            });
          if (password.length < 12)
            return send(400, {
              error: "Use a password of at least 12 characters.",
            });
          const salt = randomBytes(24).toString("hex");
          const result = db
            .prepare(
              "INSERT INTO users(username,password_hash,salt,role,created_at) VALUES(?,?,?,?,?)",
            )
            .run(
              username,
              passwordHash(password, salt),
              salt,
              "admin",
              new Date().toISOString(),
            );
          user = {
            id: Number(result.lastInsertRowid),
            username,
            role: "admin",
          };
          setupConsumed = true;
          audit(user.id, "admin_created");
        } else {
          user = db
            .prepare("SELECT * FROM users WHERE username=?")
            .get(username);
          const salt = user?.salt || "invalid-user-salt";
          const candidate = passwordHash(password, salt);
          if (
            !user ||
            !timingSafeEqual(
              Buffer.from(candidate, "hex"),
              Buffer.from(user.password_hash, "hex"),
            )
          )
            return send(401, { error: "Invalid username or password." });
        }
        attempts.delete(attemptKey);
        const token = randomBytes(32).toString("hex");
        db.prepare("DELETE FROM sessions WHERE expires<?").run(time);
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          hash(token),
          user.id,
          time + 8 * 3600000,
        );
        audit(user.id, "login");
        return send(
          200,
          { user: publicUser(getUserAfterLogin(user.id)) },
          {
            "Set-Cookie": `attendance_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production ? "; Secure" : ""}`,
          },
        );
      }
      const user = getUser();
      if (!user) return send(401, { error: "Sign in to access attendance." });
      if (path === "/api/events" && req.method === "GET") {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
        });
        res.write("data: " + revision + "\n\n");
        streams.add(res);
        const timer = setInterval(() => {
          if (!getUser()) {
            clearInterval(timer);
            streams.delete(res);
            res.end();
          } else res.write(": heartbeat\n\n");
        }, 15000);
        req.on("close", () => {
          clearInterval(timer);
          streams.delete(res);
        });
        return;
      }
      if (path === "/api/logout" && req.method === "POST") {
        const token = getToken();
        if (token)
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            hash(token),
          );
        return send(
          200,
          { ok: true },
          {
            "Set-Cookie": `attendance_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production ? "; Secure" : ""}`,
          },
        );
      }
      if (
        platformRoute({
          db,
          user,
          path,
          method: req.method,
          body,
          send,
          audit,
        }) !== false
      )
        return;
      if (path === "/api/records" && req.method === "GET") {
        return send(200, dashboardData(db, user));
      }
      if (path === "/api/records" && req.method === "POST") {
        if (!writable(user))
          return send(403, {
            error: "Your role has read-only attendance access.",
          });
        if (
          !Array.isArray(body.records) ||
          !body.records.length ||
          body.records.length > 30000
        )
          return send(400, {
            error: "Supply between 1 and 30,000 student records.",
          });
        let records;
        try {
          records = body.records.map((r) => {
            if (
              !r ||
              typeof r !== "object" ||
              Object.keys(r).some(
                (k) =>
                  ![
                    "date",
                    "student_code",
                    "grade",
                    "division",
                    "status",
                    "reason",
                    "note",
                    "parent_notified",
                    "arrival_time",
                  ].includes(k),
              )
            )
              throw Error("Only coded attendance fields may be saved.");
            const clean = validateRecord(r);
            if (clean.division !== divisionForGrade(clean.grade))
              throw Error("Division must match the student’s grade.");
            return clean;
          });
        } catch (e) {
          return send(400, { error: e.message });
        }
        for (const r of records) {
          const prior = db
            .prepare(
              "SELECT grade FROM attendance WHERE date=? AND student_code=?",
            )
            .get(r.date, r.student_code);
          if (
            locked(db, r.date, r.grade) ||
            (prior && locked(db, r.date, prior.grade))
          )
            return send(409, {
              error:
                "This register is finalized. An administrator must reopen it before changes.",
            });
          if (user.role !== "admin" && user.persona === "teacher") {
            const student = db
              .prepare("SELECT * FROM roster WHERE student_code=?")
              .get(r.student_code);
            if (
              !student ||
              !readable(user, student) ||
              student.grade !== r.grade
            )
              return send(403, {
                error:
                  "Teachers can mark only students in their assigned class and grade.",
              });
          }
        }
        for (const r of records)
          if (
            db
              .prepare("SELECT 1 FROM grade_totals WHERE date=? AND grade=?")
              .get(r.date, r.grade)
          )
            return send(409, {
              error:
                "This grade uses count entry for that date. Clear its saved counts before marking individual students.",
            });
        const seen = new Set();
        for (const r of records) {
          const key = r.date + "|" + r.student_code;
          if (seen.has(key))
            return send(400, {
              error: "Duplicate student/date entries are not permitted.",
            });
          seen.add(key);
        }
        const insert = db.prepare(
          "INSERT INTO attendance(date,student_code,grade,division,status,updated_by,updated_at,reason,note,parent_notified,arrival_time,class_name,house) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date,student_code) DO UPDATE SET grade=excluded.grade,division=excluded.division,status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at,reason=excluded.reason,note=excluded.note,parent_notified=excluded.parent_notified,arrival_time=excluded.arrival_time,class_name=excluded.class_name,house=excluded.house",
        );
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const r of records) {
            const previous = db
              .prepare(
                "SELECT * FROM attendance WHERE date=? AND student_code=?",
              )
              .get(r.date, r.student_code);
            const student = db
              .prepare(
                "SELECT class_name,house FROM roster WHERE student_code=?",
              )
              .get(r.student_code);
            const stamp = new Date().toISOString();
            if (
              !previous ||
              previous.status !== r.status ||
              previous.note !== (r.note || "") ||
              previous.reason !== (r.reason || "") ||
              previous.parent_notified !== (r.parent_notified ? 1 : 0) ||
              previous.arrival_time !== (r.arrival_time || "")
            )
              db.prepare(
                "INSERT INTO attendance_events(date,student_code,old_status,new_status,actor,recorded_at) VALUES(?,?,?,?,?,?)",
              ).run(
                r.date,
                r.student_code,
                previous?.status || null,
                r.status,
                user.id,
                stamp,
              );
            insert.run(
              r.date,
              r.student_code,
              r.grade,
              r.division,
              r.status,
              user.id,
              new Date().toISOString(),
              r.reason || "",
              r.note || "",
              r.parent_notified ? 1 : 0,
              r.arrival_time || "",
              student?.class_name || "",
              student?.house || "",
            );
            db.prepare(
              "INSERT INTO roster(student_code,grade,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(student_code) DO UPDATE SET grade=excluded.grade,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE ? >= (SELECT MAX(date) FROM attendance WHERE student_code=excluded.student_code)",
            ).run(
              r.student_code,
              r.grade,
              user.id,
              new Date().toISOString(),
              r.date,
            );
          }
          audit(user.id, "records_saved", records.length);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        return send(200, { saved: records.length });
      }
      if (path === "/api/records" && req.method === "DELETE") {
        if (!writable(user))
          return send(403, {
            error: "Your role has read-only attendance access.",
          });
        const prior = db
          .prepare("SELECT * FROM attendance WHERE date=? AND student_code=?")
          .get(body.date || "", body.student_code || "");
        if (prior && locked(db, prior.date, prior.grade))
          return send(409, { error: "This register is finalized." });
        if (
          user.role !== "admin" &&
          user.persona === "teacher" &&
          !readable(
            user,
            db
              .prepare("SELECT * FROM roster WHERE student_code=?")
              .get(body.student_code || ""),
          )
        )
          return send(403, {
            error: "Student is outside your assigned class.",
          });
        if (prior)
          db.prepare(
            "INSERT INTO attendance_events(date,student_code,old_status,new_status,actor,recorded_at) VALUES(?,?,?,?,?,?)",
          ).run(
            prior.date,
            prior.student_code,
            prior.status,
            null,
            user.id,
            new Date().toISOString(),
          );
        if (
          typeof body.date !== "string" ||
          typeof body.student_code !== "string"
        )
          return send(400, {
            error: "Specify the attendance date and student code.",
          });
        const result = db
          .prepare("DELETE FROM attendance WHERE date=? AND student_code=?")
          .run(body.date, body.student_code);
        audit(user.id, "record_deleted", Number(result.changes));
        return send(200, { deleted: Number(result.changes) });
      }
      if (path === "/api/roster" && req.method === "POST") {
        if (!registrar(user))
          return send(403, {
            error: "Only secretaries and administrators may change the roster.",
          });
        if (
          !Array.isArray(body.students) ||
          !body.students.length ||
          body.students.length > 10000
        )
          return send(400, { error: "Supply 1–10,000 coded roster students." });
        let students;
        try {
          students = body.students.map((r) => {
            if (
              !r ||
              Object.keys(r).some(
                (k) =>
                  ![
                    "student_code",
                    "grade",
                    "display_name",
                    "registration_number",
                    "class_name",
                    "house",
                  ].includes(k),
              )
            )
              throw Error(
                "Roster accepts only a display name, registration number, grade, and optional internal code.",
              );
            return validateRosterStudent(r);
          });
        } catch (e) {
          return send(400, { error: e.message });
        }
        const seenCodes = new Set(),
          seenRegistrations = new Set();
        for (const r of students) {
          const registration = r.registration_number?.toUpperCase();
          if (
            (r.student_code && seenCodes.has(r.student_code)) ||
            (registration && seenRegistrations.has(registration))
          )
            return send(400, {
              error:
                "Duplicate student codes or registration numbers in roster.",
            });
          const existingRegistration = registration
            ? db
                .prepare(
                  "SELECT student_code FROM roster WHERE registration_number=? COLLATE NOCASE",
                )
                .get(r.registration_number)
            : null;
          const existingCode = r.student_code
            ? db
                .prepare(
                  "SELECT registration_number FROM roster WHERE student_code=?",
                )
                .get(r.student_code)
            : null;
          if (
            existingRegistration &&
            r.student_code &&
            existingCode &&
            existingRegistration.student_code !== r.student_code
          )
            return send(409, {
              error:
                "That registration number and internal code belong to different roster entries.",
            });
          if (
            existingCode?.registration_number &&
            registration &&
            existingCode.registration_number.toUpperCase() !== registration
          )
            return send(409, {
              error:
                "An internal code is already linked to a different registration number.",
            });
          r.student_code =
            existingRegistration?.student_code ||
            r.student_code ||
            "S-" + randomBytes(8).toString("hex").toUpperCase();
          if (seenCodes.has(r.student_code))
            return send(400, { error: "Duplicate students in roster." });
          seenCodes.add(r.student_code);
          if (registration) seenRegistrations.add(registration);
        }
        const statement = db.prepare(
          "INSERT INTO roster(student_code,grade,updated_by,updated_at,display_name,registration_number,class_name,house) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_code) DO UPDATE SET grade=excluded.grade,updated_by=excluded.updated_by,updated_at=excluded.updated_at,display_name=CASE WHEN excluded.display_name<>'' THEN excluded.display_name ELSE roster.display_name END,registration_number=CASE WHEN excluded.registration_number<>'' THEN excluded.registration_number ELSE roster.registration_number END,class_name=COALESCE(?,roster.class_name),house=COALESCE(?,roster.house)",
        );
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const r of students)
            statement.run(
              r.student_code,
              r.grade,
              user.id,
              new Date().toISOString(),
              r.display_name || "",
              r.registration_number || "",
              r.class_name || "",
              r.house || "",
              r.class_name ?? null,
              r.house ?? null,
            );
          audit(user.id, "roster_saved", students.length);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        return send(200, { saved: students.length });
      }
      if (path === "/api/totals" && req.method === "POST") {
        if (!registrar(user))
          return send(403, {
            error:
              "Only secretaries and administrators may enter grade totals.",
          });
        if (locked(db, body.date, body.grade))
          return send(409, { error: "This register is finalized." });
        let t;
        try {
          if (
            Object.keys(body).some(
              (k) =>
                ![
                  "date",
                  "grade",
                  "total",
                  "absent",
                  "leave",
                  "late",
                  "excused",
                  "half_day",
                ].includes(k),
            )
          )
            throw Error("Only grade attendance counts may be saved.");
          t = validateTotals(body);
        } catch (e) {
          return send(400, { error: e.message });
        }
        if (
          db
            .prepare("SELECT 1 FROM attendance WHERE date=? AND grade=?")
            .get(t.date, t.grade)
        )
          return send(409, {
            error:
              "Individual attendance is already recorded for this grade and date. Continue with the student register, or remove those entries before using counts.",
          });
        db.prepare(
          "INSERT INTO grade_totals(date,grade,total,present,absent,leave,late,updated_by,updated_at,excused,half_day) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date,grade) DO UPDATE SET total=excluded.total,present=excluded.present,absent=excluded.absent,leave=excluded.leave,late=excluded.late,excused=excluded.excused,half_day=excluded.half_day,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
        ).run(
          t.date,
          t.grade,
          t.total,
          t.present,
          t.absent,
          t.leave,
          t.late,
          user.id,
          new Date().toISOString(),
          t.excused || 0,
          t.half_day || 0,
        );
        audit(user.id, "grade_totals_saved", t.total);
        return send(200, { ok: true });
      }
      if (path === "/api/totals" && req.method === "DELETE") {
        if (!registrar(user))
          return send(403, {
            error: "Only secretaries and administrators may change totals.",
          });
        if (locked(db, body.date, body.grade))
          return send(409, { error: "This register is finalized." });
        if (typeof body.date !== "string" || typeof body.grade !== "string")
          return send(400, { error: "Select a date and grade." });
        const result = db
          .prepare("DELETE FROM grade_totals WHERE date=? AND grade=?")
          .run(body.date, body.grade);
        audit(user.id, "grade_totals_deleted", Number(result.changes));
        return send(200, { deleted: Number(result.changes) });
      }
      if (path === "/api/users" && req.method === "GET") {
        if (user.role !== "admin")
          return send(403, { error: "Administrator access required." });
        return send(200, {
          users: db
            .prepare(
              "SELECT id,username,role,persona,scope_division,assigned_class FROM users ORDER BY username",
            )
            .all(),
        });
      }
      if (path === "/api/users" && req.method === "POST") {
        if (!localAuth)
          return send(403, {
            error: "Manage staff assignments and roles in Microsoft Entra.",
          });
        if (user.role !== "admin")
          return send(403, { error: "Administrator access required." });
        const { username, password } = body;
        if (
          typeof username !== "string" ||
          !/^[a-zA-Z0-9._-]{3,40}$/.test(username) ||
          typeof password !== "string" ||
          password.length < 12 ||
          password.length > 128
        )
          return send(400, {
            error:
              "Use a 3–40 character username and a 12–128 character password.",
          });
        if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username))
          return send(409, { error: "This username is already registered." });
        const salt = randomBytes(24).toString("hex");
        db.prepare(
          "INSERT INTO users(username,password_hash,salt,role,created_at) VALUES(?,?,?,?,?)",
        ).run(
          username,
          passwordHash(password, salt),
          salt,
          "staff",
          new Date().toISOString(),
        );
        audit(user.id, "staff_created");
        return send(201, { ok: true });
      }
      if (path === "/api/users" && req.method === "DELETE") {
        if (!localAuth)
          return send(403, {
            error:
              "Manage staff access in Microsoft Entra. Existing sessions expire within eight hours.",
          });
        if (user.role !== "admin")
          return send(403, { error: "Administrator access required." });
        if (!Number.isSafeInteger(body.id) || body.id === user.id)
          return send(400, { error: "Choose another staff account." });
        // Retain authorship, disable credentials, and revoke all sessions.
        const target = db
          .prepare("SELECT role FROM users WHERE id=?")
          .get(body.id);
        if (!target || target.role !== "staff")
          return send(400, { error: "Choose a staff account." });
        const salt = randomBytes(24).toString("hex");
        db.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=?").run(
          passwordHash(randomBytes(32).toString("hex"), salt),
          salt,
          body.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(body.id);
        audit(user.id, "staff_access_revoked");
        return send(200, { ok: true });
      }
      return send(404, { error: "Not found." });
      function getToken() {
        return req.headers.cookie
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("attendance_session="))
          ?.slice("attendance_session=".length);
      }
      function getUser() {
        const token = getToken();
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
        return db
          .prepare(
            "SELECT users.id,users.username,users.role,COALESCE(NULLIF(users.persona,''),'secretary') AS persona,users.scope_division,users.assigned_class FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?",
          )
          .get(hash(token), Date.now());
      }
    } catch {
      if (!res.headersSent)
        send(500, {
          error: "The server could not complete the request. Please retry.",
        });
      else res.end();
    }
  });
  const close = server.close.bind(server);
  server.close = (callback) => {
    for (const res of streams) res.end();
    streams.clear();
    return close(callback);
  };
  server.on("close", () => db.close());
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await createApp();
  server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        "Attendance application listening on port " +
          (process.env.PORT || 3000),
      ),
  );
}
