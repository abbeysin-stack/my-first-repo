import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server.js";
const record = {
  date: "2026-10-29",
  student_code: "S-A7K9M2Q4",
  grade: "3",
  division: "Junior School (PYP)",
  status: "absent",
};
async function start(options = {}) {
  const server = await createApp({ dbPath: ":memory:", ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    server,
    base,
    async request(path, { method = "GET", body, cookie, origin = base } = {}) {
      return fetch(base + path, {
        method,
        headers: {
          ...(body
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
async function admin(app) {
  const res = await app.request("/api/setup", {
    method: "POST",
    body: { username: "test.admin", password: "fictional-test-password-42" },
  });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie").split(";")[0];
}
test("default mode requires Microsoft; no implicit administrator creation", async () => {
  const app = await start();
  try {
    const session = await (await app.request("/api/session")).json();
    assert.equal(session.authMode, "microsoft");
    assert.equal(session.microsoftConfigured, false);
    assert.equal((await app.request("/api/records")).status, 401);
    assert.equal(
      (
        await app.request("/api/setup", {
          method: "POST",
          body: { username: "test", password: "fictional-test-password-42" },
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});
test("authenticated writes persist across restart, PII is rejected, CSRF blocked and logout revokes session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "attendance-test-"));
  let app = await start({
    dbPath: join(dir, "attendance.sqlite"),
    allowSetup: true,
  });
  try {
    const cookie = await admin(app);
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          origin: "https://attacker.example",
          body: { records: [record] },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: { records: [{ ...record, name: "PRIVATE_PERSON" }] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: { records: [{ ...record, division: "Secondary (IB DP)" }] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: { records: [record] },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: { records: [{ ...record, status: "present" }] },
        })
      ).status,
      200,
    );
    await app.close();
    app = await start({
      dbPath: join(dir, "attendance.sqlite"),
      allowSetup: true,
    });
    const login = await app.request("/api/login", {
      method: "POST",
      body: { username: "test.admin", password: "fictional-test-password-42" },
    });
    const newCookie = login.headers.get("set-cookie").split(";")[0];
    assert.deepEqual(
      (await (await app.request("/api/records", { cookie: newCookie })).json())
        .records,
      [{ ...record, status: "present" }],
    );
    assert.equal(
      (
        await app.request("/api/logout", {
          method: "POST",
          cookie: newCookie,
          body: {},
        })
      ).status,
      200,
    );
    assert.equal(
      (await app.request("/api/records", { cookie: newCookie })).status,
      401,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("staff can record attendance but cannot provision accounts; access revocation expires their session", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    assert.equal(
      (
        await app.request("/api/users", {
          method: "POST",
          cookie,
          body: {
            username: "test.staff",
            password: "fictional-staff-password-42",
          },
        })
      ).status,
      201,
    );
    const login = await app.request("/api/login", {
      method: "POST",
      body: { username: "test.staff", password: "fictional-staff-password-42" },
    });
    const staffCookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie: staffCookie,
          body: { records: [record] },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/users", {
          method: "POST",
          cookie: staffCookie,
          body: {
            username: "bad.staff",
            password: "fictional-staff-password-42",
          },
        })
      ).status,
      403,
    );
    const users = (await (await app.request("/api/users", { cookie })).json())
      .users;
    const id = users.find((x) => x.username === "test.staff").id;
    await app.request("/api/users", { method: "DELETE", cookie, body: { id } });
    assert.equal(
      (await app.request("/api/records", { cookie: staffCookie })).status,
      401,
    );
  } finally {
    await app.close();
  }
});
test("production rejects missing HTTPS origin", async () => {
  await assert.rejects(
    createApp({ production: true, dbPath: ":memory:" }),
    /HTTPS/,
  );
});
test("counts and individual mode are exclusive per grade/date; clear counts unlocks roster marking", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    const post = (path, body) =>
      app.request(path, { method: "POST", cookie, body });
    const t = {
      date: record.date,
      grade: "3",
      total: 30,
      absent: 2,
      leave: 1,
      late: 1,
    };
    assert.equal((await post("/api/totals", t)).status, 200);
    assert.equal(
      (await post("/api/records", { records: [record] })).status,
      409,
    );
    let data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.totals[0].present, 26);
    assert.equal(data.records.length, 0);
    assert.equal(
      (
        await post("/api/roster", {
          students: [{ student_code: record.student_code, grade: "3" }],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/totals", {
          method: "DELETE",
          cookie,
          body: { date: record.date, grade: "3" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/api/records", {
          records: [{ ...record, reason: "appointment" }],
        })
      ).status,
      200,
    );
    assert.equal((await post("/api/totals", t)).status, 409);
    data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.records[0].reason, "appointment");
    assert.equal(data.roster[0].student_code, record.student_code);
    assert.equal(data.totals.length, 0);
  } finally {
    await app.close();
  }
});
test("reason descriptions are allowlisted and unsupported fields are rejected", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    for (const value of [
      { ...record, reason: "PRIVATE_MEDICAL_NOTE" },
      { ...record, description: "PRIVATE_NOTE" },
      { ...record, status: "present", reason: "illness" },
    ]) {
      const res = await app.request("/api/records", {
        method: "POST",
        cookie,
        body: { records: [value] },
      });
      assert.equal(res.status, 400);
      assert.doesNotMatch(JSON.stringify(await res.json()), /PRIVATE/);
    }
    assert.equal(
      (
        await app.request("/api/roster", {
          method: "POST",
          cookie,
          body: {
            students: [
              {
                student_code: record.student_code,
                grade: "3",
                name: "PRIVATE_NAME",
              },
            ],
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await app.request("/api/totals", {
          method: "POST",
          cookie,
          body: {
            date: record.date,
            grade: "3",
            total: 10,
            absent: 11,
            leave: 0,
            late: 0,
          },
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
  }
});

test("older database migration preserves attendance and new counts persist across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "attendance-migration-"));
  const dbPath = join(dir, "old.sqlite");
  const old = new DatabaseSync(dbPath);
  old.exec(
    "CREATE TABLE attendance(date TEXT,student_code TEXT,grade TEXT,division TEXT,status TEXT,updated_by INTEGER,updated_at TEXT,PRIMARY KEY(date,student_code))",
  );
  old
    .prepare("INSERT INTO attendance VALUES(?,?,?,?,?,?,?)")
    .run(
      record.date,
      record.student_code,
      record.grade,
      record.division,
      record.status,
      1,
      "2026-10-29T00:00:00Z",
    );
  old.close();
  let app = await start({ dbPath, allowSetup: true });
  try {
    const cookie = await admin(app);
    let data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.records[0].reason, "unexplained");
    assert.equal(data.roster[0].student_code, record.student_code);
    assert.equal(
      (
        await app.request("/api/totals", {
          method: "POST",
          cookie,
          body: {
            date: record.date,
            grade: "9",
            total: 20,
            absent: 2,
            leave: 1,
            late: 0,
          },
        })
      ).status,
      200,
    );
    await app.close();
    app = await start({ dbPath, allowSetup: true });
    data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.totals[0].present, 17);
    assert.equal(data.records[0].status, "absent");
    assert.equal(data.roster.length, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("named students and staff notes persist; registration upsert keeps the same opaque identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "attendance-identities-"));
  const dbPath = join(dir, "attendance.sqlite");
  let app = await start({ dbPath, allowSetup: true });
  try {
    const cookie = await admin(app);
    const student = {
      display_name: "Ava R.",
      registration_number: "000123",
      grade: "3",
    };
    assert.equal(
      (
        await app.request("/api/roster", {
          method: "POST",
          cookie,
          body: { students: [student] },
        })
      ).status,
      200,
    );
    let data = await (await app.request("/api/records", { cookie })).json();
    const code = data.roster[0].student_code;
    assert.match(code, /^S-[A-F0-9]{16}$/);
    assert.equal(data.roster[0].registration_number, "000123");
    await app.request("/api/roster", {
      method: "POST",
      cookie,
      body: { students: [{ ...student, display_name: "Ava S." }] },
    });
    data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.roster.length, 1);
    assert.equal(data.roster[0].student_code, code);
    assert.equal(data.roster[0].display_name, "Ava S.");
    const attendance = {
      ...record,
      student_code: code,
      reason: "appointment",
      note: "Guardian confirmed appointment. <script>not executable</script>",
    };
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: { records: [attendance] },
        })
      ).status,
      200,
    );
    await app.close();
    app = await start({ dbPath, allowSetup: true });
    data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.records[0].note, attendance.note);
    assert.equal(data.roster[0].registration_number, "000123");
    assert.equal(data.roster[0].display_name, "Ava S.");
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: {
            records: [{ ...record, student_code: code, status: "present" }],
          },
        })
      ).status,
      200,
    );
    data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.records[0].note, undefined);
    assert.equal(data.records[0].reason, undefined);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("names use last initials; registration collisions and invalid staff notes are rejected without reflecting input", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    const named = {
      student_code: record.student_code,
      display_name: "Ava R.",
      registration_number: "000123",
      grade: "3",
    };
    assert.equal(
      (
        await app.request("/api/roster", {
          method: "POST",
          cookie,
          body: { students: [named] },
        })
      ).status,
      200,
    );
    for (const students of [
      [{ ...named, registration_number: "999999" }],
      [{ ...named, display_name: "Ava PRIVATE_SURNAME" }],
      [
        { display_name: "Leo T.", registration_number: "abc", grade: "3" },
        { display_name: "Maya R.", registration_number: "ABC", grade: "3" },
      ],
    ]) {
      const res = await app.request("/api/roster", {
        method: "POST",
        cookie,
        body: { students },
      });
      assert.ok([400, 409].includes(res.status));
      assert.doesNotMatch(JSON.stringify(await res.json()), /PRIVATE_SURNAME/);
    }
    for (const value of [
      { ...record, note: "x".repeat(1001) },
      { ...record, note: "bad\u0000note" },
      { ...record, status: "present", note: "PRIVATE_NOTE" },
    ])
      assert.equal(
        (
          await app.request("/api/records", {
            method: "POST",
            cookie,
            body: { records: [value] },
          })
        ).status,
        400,
      );
  } finally {
    await app.close();
  }
});
test("teacher and division scopes are enforced by API; executive data has no student identities", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    const students = [
      {
        student_code: "S-TEACHER1",
        display_name: "Mira T.",
        registration_number: "000001",
        grade: "3",
        class_name: "3-A",
        house: "Cedar",
      },
      {
        student_code: "S-TEACHER2",
        display_name: "Jude R.",
        registration_number: "000002",
        grade: "3",
        class_name: "3-B",
        house: "Maple",
      },
      {
        student_code: "S-SENIOR01",
        display_name: "Arun S.",
        registration_number: "000003",
        grade: "11",
        class_name: "11-A",
        house: "Oak",
      },
    ];
    await app.request("/api/roster", {
      method: "POST",
      cookie,
      body: { students },
    });
    await app.request("/api/records", {
      method: "POST",
      cookie,
      body: {
        records: students.map((s) => ({
          ...record,
          student_code: s.student_code,
          grade: s.grade,
          division:
            s.grade === "11" ? "Secondary (IB DP)" : "Junior School (PYP)",
          note: "PRIVATE_FOLLOWUP",
        })),
      },
    });
    async function scoped(username, persona, scope = {}) {
      await app.request("/api/users", {
        method: "POST",
        cookie,
        body: { username, password: "fictional-staff-password-42" },
      });
      const users = (await (await app.request("/api/users", { cookie })).json())
        .users;
      const id = users.find((u) => u.username === username).id;
      assert.equal(
        (
          await app.request("/api/access", {
            method: "PATCH",
            cookie,
            body: { id, persona, ...scope },
          })
        ).status,
        200,
      );
      const res = await app.request("/api/login", {
        method: "POST",
        body: { username, password: "fictional-staff-password-42" },
      });
      return res.headers.get("set-cookie").split(";")[0];
    }
    const teacher = await scoped("test.teacher", "teacher", {
      assigned_class: "3-A",
    });
    let data = await (
      await app.request("/api/records", { cookie: teacher })
    ).json();
    assert.equal(data.roster.length, 1);
    assert.equal(data.roster[0].registration_number, "000001");
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie: teacher,
          body: { records: [{ ...record, student_code: "S-TEACHER2" }] },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie: teacher,
          body: {
            records: [
              {
                ...record,
                student_code: "S-TEACHER1",
                status: "late",
                arrival_time: "08:21",
                parent_notified: true,
              },
            ],
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/roster", {
          method: "POST",
          cookie: teacher,
          body: { students: [students[0]] },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/api/finalize", {
          method: "POST",
          cookie: teacher,
          body: { date: record.date, grades: ["3"] },
        })
      ).status,
      403,
    );
    const head = await scoped("test.head", "division", {
      scope_division: "Junior School (PYP)",
    });
    data = await (await app.request("/api/records", { cookie: head })).json();
    assert.equal(data.roster.length, 2);
    assert.doesNotMatch(JSON.stringify(data), /000003|Arun S|S-SENIOR01/);
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie: head,
          body: { records: [record] },
        })
      ).status,
      403,
    );
    const exec = await scoped("test.executive", "executive");
    data = await (await app.request("/api/records", { cookie: exec })).json();
    assert.deepEqual(data.roster, []);
    assert.deepEqual(data.records, []);
    assert.ok(data.metrics.length);
    assert.doesNotMatch(
      JSON.stringify(data),
      /PRIVATE_FOLLOWUP|000001|Mira T|S-TEACHER1/,
    );
    assert.equal(
      (
        await app.request("/api/access", {
          method: "PATCH",
          cookie: teacher,
          body: { id: 2, persona: "secretary" },
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});
test("finalization requires coverage and rejects all attendance mutations until admin reopens", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    const students = [
      { student_code: record.student_code, grade: "3" },
      { student_code: "S-B7K9M2Q4", grade: "3" },
    ];
    await app.request("/api/roster", {
      method: "POST",
      cookie,
      body: { students },
    });
    await app.request("/api/records", {
      method: "POST",
      cookie,
      body: { records: [record] },
    });
    const finalize = () =>
      app.request("/api/finalize", {
        method: "POST",
        cookie,
        body: { date: record.date, grades: ["3"] },
      });
    assert.equal((await finalize()).status, 409);
    await app.request("/api/records", {
      method: "POST",
      cookie,
      body: {
        records: [{ ...record, student_code: "S-B7K9M2Q4", status: "present" }],
      },
    });
    assert.equal((await finalize()).status, 200);
    for (const [path, method, body] of [
      ["/api/records", "POST", { records: [{ ...record, status: "present" }] }],
      ["/api/records", "POST", { records: [{ ...record, grade: "4" }] }],
      [
        "/api/records",
        "DELETE",
        { date: record.date, student_code: record.student_code },
      ],
      [
        "/api/totals",
        "POST",
        {
          date: record.date,
          grade: "3",
          total: 2,
          absent: 0,
          leave: 0,
          late: 0,
        },
      ],
    ])
      assert.equal(
        (await app.request(path, { method, cookie, body })).status,
        409,
      );
    assert.equal(
      (
        await app.request("/api/finalize", {
          method: "DELETE",
          cookie,
          body: { date: record.date, grade: "3" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: { records: [{ ...record, status: "present" }] },
        })
      ).status,
      200,
    );
    const events = (await (await app.request("/api/audit", { cookie })).json())
      .events;
    assert.ok(
      events.some(
        (e) =>
          e.old_status === "absent" &&
          e.new_status === "present" &&
          e.actor === 1 &&
          e.recorded_at,
      ),
    );
  } finally {
    await app.close();
  }
});
test("excused and half-day counts preserve denominator and new classifications", async () => {
  const app = await start({ allowSetup: true });
  try {
    const cookie = await admin(app);
    assert.equal(
      (
        await app.request("/api/totals", {
          method: "POST",
          cookie,
          body: {
            date: record.date,
            grade: "9",
            total: 10,
            absent: 1,
            leave: 1,
            late: 1,
            excused: 2,
            half_day: 1,
          },
        })
      ).status,
      200,
    );
    let data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.totals[0].present, 4);
    assert.equal(
      (
        await app.request("/api/records", {
          method: "POST",
          cookie,
          body: {
            records: [
              {
                ...record,
                status: "excused",
                reason: "school_event",
                parent_notified: true,
              },
            ],
          },
        })
      ).status,
      200,
    );
    data = await (await app.request("/api/records", { cookie })).json();
    assert.equal(data.records[0].status, "excused");
    assert.equal(data.records[0].parent_notified, true);
  } finally {
    await app.close();
  }
});
