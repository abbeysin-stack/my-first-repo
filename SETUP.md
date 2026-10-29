# Attend — environment and school deployment

This branch is the structural review of the uploaded engineering specification. Read [docs/SPECIFICATION_REVIEW.md](docs/SPECIFICATION_REVIEW.md) for the implementation/acceptance matrix. No school deployment, legal-compliance certification or live Microsoft acceptance is implied by a successful local build.

## Install, run and validate

Node.js 24.5+ is required; validated on 24.19. Use the existing checkout: each cloud task is already isolated, so no Git worktree is needed.

```sh
cd /workspace/my-first-repo
npm ci
npm run lint
npm test
npm run build
npm run serve
```

`npm start` builds the frontend and starts the service in one command. `npm run serve` reuses an existing `dist/` build. In this restricted cloud machine use `npm ci --cache /tmp/attendance-npm-cache` so the package cache is writable. The dependency lockfile is committed. The start command enables Node's environment-proxy support and preserves TLS verification.

The default listener is loopback port 3000. Without Microsoft configuration, the application offers only a fictional review workspace and real attendance endpoints return 401. Open the private port in Codespaces or use a browser on the same host. GitHub Pages cannot run the backend. Use a trusted TLS reverse proxy and keep the Node port private for school deployment.

For hot-reload development run `npm run serve` and `npm run dev` in separate terminals. Vite serves the frontend and proxies API/auth requests to port 3000. Production should serve the built assets, not the Vite development server.

## Microsoft school sign-in

A school Microsoft Entra administrator must register and assign the application. Never put secrets in Git, instructions, command output, or chat.

1. Choose a stable HTTPS address. Set `APP_ORIGIN` to the exact origin, without a trailing slash/path, such as `https://attendance.school.example`.
2. Create an Entra app registration for **Accounts in this organizational directory only**. Add a **Web** redirect URI: `https://YOUR-APP-HOST/auth/microsoft/callback`. Do not use the SPA or implicit grant configuration.
3. Configure these through secure environment settings:

   | Variable | Purpose |
   | --- | --- |
   | `MS_TENANT_ID` | School directory GUID |
   | `MS_CLIENT_ID` | App registration/client GUID |
   | `MS_CLIENT_SECRET` | Server client secret, entered securely; rotate before expiry |
   | `APP_ORIGIN` | Exact HTTPS origin |
   | `NODE_ENV` | `production` for HTTPS validation, Secure cookies, HSTS |
   | `ATTENDANCE_DB_PATH` | Optional protected durable database path; default `.local/attendance.sqlite` |

4. Enable application roles for users/groups. Supported role values:

   | Entra role | Application permission |
   | --- | --- |
   | `Attendance.Admin` | All views, account scope administration, calendar, register reopening |
   | `Attendance.Secretary` | School roster intake, attendance, grade totals, finalization and reporting |
   | `Attendance.Teacher` | Assigned-class roster and attendance only |
   | `Attendance.DivisionHead` | Assigned-division read-only records and follow-up |
   | `Attendance.Executive` | School aggregate data only, no individual students or notes |
   | `Attendance.Staff` | Legacy staff role; defaults to secretary or the application's administrator-assigned persona |

5. Require assignment in Enterprise applications and assign authorized staff/groups. Only `openid` is requested; this integration does not read a guardian directory or Microsoft Graph. Follow the school's consent policy.
6. Teachers/division heads have no student access until an administrator assigns the exact class/division in **Administration**. The user appears after first sign-in. Scope changes revoke existing application sessions; the user must sign in again. Explicit Entra persona roles are reapplied at subsequent sign-in; the stored class/division scope remains. Administrators may review all workspace presentations; a view switch never changes server authorization.
7. Allow server HTTPS access to `login.microsoftonline.com`. Restart after setting configuration and test assigned, unassigned and external-tenant accounts using fictional data.

The integration uses authorization code + PKCE, cookie-bound state, nonce, Microsoft JWKS signatures, issuer/audience/tenant validation, time bounds and assigned roles. Session tokens are hashed in SQLite, HttpOnly, SameSite and Secure in production, with an eight-hour lifetime. No passwords/identity tokens are placed in browser application storage. Removing an Entra assignment blocks new sign-in; an existing app session may remain usable until expiry unless its database session is revoked or the service is stopped.

Official reference: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow

Live school sign-in remains unverified until the school registration, secret, HTTPS address and assignments exist. Automated identity tests use locally signed fixtures, not a real tenant.

## Divisions, roster and record contracts

| Grades | Division |
| --- | --- |
| 1–5 | Junior School (PYP) |
| 6–7 | Junior School (MYP) |
| 8–10 | Secondary (IGCSE) |
| 11–12 | Secondary (IB DP) |

This mapping follows the user's earlier instructions, rather than the PDF's three generic divisions. Grade is a string from `1` through `12`; division is validated server-side.

Named roster CSV: `display_name,registration_number,grade`, with optional `class_name,house,student_code`. `display_name` is first name(s) plus a single last initial, e.g. `Ava R.`. Registration is text, including leading zeros. New opaque internal codes are generated using cryptographic randomness. Reusing a registration number updates the same student. Use the optional existing `student_code` to link legacy history; conflicting identity links are rejected. Legacy `student_code,grade` imports remain supported. Class labels must exactly match staff assignments, e.g. `10-A`. House labels are school-defined.

Attendance CSV: `date,student_code,grade,division,status`, with optional `reason,note`. Dates use `YYYY-MM-DD`; status is `present`, `absent`, `late`, `excused`, `half_day` or legacy `leave`. The API additionally supports boolean `parent_notified` and `arrival_time` (`HH:mm`). These two fields are entered in the interface/API rather than the legacy CSV reader. Parent confirmation means contact has already occurred; it sends nothing.

Reason values: `illness`, `appointment`, `family`, `authorized`, `unexplained`, `school_event`, `religious`, `visa`, `other`. Reasons apply to absence/excused/leave/half-day records. Notes are optional plain text up to 1,000 characters; present clears note/reason context. Late arrivals support a staff note and arrival time. Notes are escaped for rendering, not automatically scrubbed for medical or personal details. Unknown extra CSV fields are removed before API requests. Raw CSV files stay in the browser. Import bounds: 5 MB, 10,000 roster students, 30,000 attendance records per batch. Export Excel worksheets as UTF-8 CSV for import.

One student/date has one record. CSV duplicate student/date rows are rejected; subsequent saves update that record. Grade counts and individual records are mutually exclusive per grade/date, enforced by the API. Counts calculate present = total minus absent, leave, late, excused and half-day. Counts do not create individual history or establish an individual muster list. Unmarked students are never silently assumed present; bulk-present explicitly confirms the unmarked students and preserves exceptions.

## Calculations, reporting and finalization

- Daily KPI/email rate: **present / all submitted records**. Late, excused, half-day and leave stay separate. Half-day does not receive 0.5 present credit under this rule.
- Calendar rate: **present / current roster enrollment**. Thresholds are >=95% goal, >=90% normal, >=85% warning, <85% concern. No data, weekends and configured non-instructional dates are neutral. Missing submissions affect coverage. Historical enrollment is not reconstructed.
- House/class filters use individual records only; grade totals cannot be attributed to a house or classroom.
- Warning list: present rate below 90% across recorded instructional days, or at least three consecutive unexplained absences. Missing instructional dates break a streak; weekends/configured closed dates do not. Small sample sizes are displayed. Warnings are prompts for staff review, not findings of truancy or diagnoses.
- Finalization requires complete current roster coverage for each individual grade/day, or saved grade totals. Pending changes must be saved/discarded first. Finalization locks API updates/deletions and totals; only an administrator can reopen. Roster enrollment changes and historical snapshots need school governance; finalization does not prove a live campus location.

The email preview uses a sandboxed iframe. EML contains standard multipart plain-text/HTML alternatives, UTF-8 base64 and X-Unsent. HTML uses inline styles and fixed-width table layout. PDF uses native browser print; PNG captures only the monthly aggregate report; Excel uses a minimal OOXML workbook with inline literal cells, not formulas. All fictional artifacts are labeled demo. Exports omit names, registrations, reason descriptions and staff notes. Small division groups are withheld; aggregation still does not guarantee anonymity. Specific Outlook clients and printers require school acceptance testing.

## Data protection, live synchronization and offline behavior

The database intentionally stores the requested names/initials, registrations, staff notes, author IDs, timestamps and attendance metadata. These are personal data, not anonymous records. Secretaries/admins have full school access, teachers only their class, division heads only their division, and executives aggregate-only API responses. Named follow-up lists are outside the printable/PNG board report. There is no new guardian contact database.

Live server events carry only a revision notice; the browser then fetches data through the current role/scope filter. A polling fallback refreshes visible workspaces. In-memory attendance writes show as pending, retry after reconnection, and remain blocked on a finalization/permission conflict until resolved/discarded. Queue contents are never written to local storage and are lost on reload/tab closure. The browser warns before leaving with pending writes. No background authentication, durable offline database, automatic parent communication or automatic leadership sending is implemented.

SQLite lives under ignored `.local/attendance.sqlite`, with restricted file/directory permissions, or a configured durable path. Source and lockfiles contain no school data or credentials. Protect the host and database with encrypted storage, approved access/retention and encrypted, tested backups before real use. Application-level database encryption and backup scheduling are not supplied. For a consistent backup use SQLite's backup API or stop the service and preserve DB/WAL/SHM together. Do not copy only the main file while writes are active. Back up before upgrading: startup applies additive migrations preserving old rows and adding scope, class/house, notification, arrival, finalization and change-event tables/columns.

Current-record author/time and status events are retained for accountability. Previous note text is not versioned. The system is designed for one application instance against its SQLite database; PostgreSQL/Cloud SQL, multi-instance coordination, historical enrollment snapshots, external SIS sync and NFC/RFID are later work. Performance, accessibility, security and school emergency/compliance acceptance remain deployment requirements, not certified outcomes.

## Isolated local authentication tests

Without Microsoft settings the real API stays locked. For development only, `ATTENDANCE_LOCAL_AUTH=1` enables loopback-only password authentication using a **separate disposable database** and fictional data. First setup creates a test administrator with a 12+ character password. Do not enable this in school deployment. Production blocks local initial setup; configured Microsoft authentication overrides local mode. Tests create isolated temporary databases and fictional accounts; they do not create real staff identities or contact Microsoft.
