# Attend — school attendance workspace

A shared school attendance application with Microsoft Entra staff sign-in, a SQLite database, grade-level entry, staff-only student identities and absence histories, CSV interchange, and formatted leadership email drafts. Node.js 24.5+ is required (validated on 24.19). No npm dependencies or build step are required.

## Start and validate

```sh
cd /workspace/my-first-repo
npm test
npm start
```

The default listener is loopback port 3000. Without Microsoft settings, the sign-in screen explains configuration and offers a fictional demo. The real attendance API remains locked. Demo data is never saved to the shared database. Use the existing checkout: each cloud task is already isolated; no Git worktree is needed.

## School divisions

| Grades | Division |
| --- | --- |
| 1–5 | Junior School (PYP) |
| 6–7 | Junior School (MYP) |
| 8–10 | Secondary (IGCSE) |
| 11–12 | Secondary (IB DP) |

Division is derived from grade on entry and verified on CSV import and server writes. The Secretary attendance desk supports grade totals or a clickable student roster with separate display-name and registration-number columns. One entry method is allowed per grade/date, enforced by the API to prevent double counting. One student/date has one attendance record; later saves update it. Grade totals calculate present from student count minus absent, leave, and late, and do not create individual histories. CSV imports reject duplicate student/date rows within a file. Present ÷ all recorded students is the attendance rate. Absent, leave, and late are separate; late is the supported exception category. Unrecorded students cannot be inferred without a roster, so the report describes recorded headcount rather than total enrollment.

## Microsoft school sign-in

A school Microsoft Entra administrator must complete these steps. Live Microsoft sign-in cannot be validated until the school registration, secret, and HTTPS deployment exist.

1. Choose the application's stable HTTPS address and configure a TLS reverse proxy to the loopback application. Set `APP_ORIGIN` to that exact origin, such as `https://attendance.school.example`, with no trailing slash or path. Keep the Node port inaccessible from the public internet.
2. In Microsoft Entra admin center, create an app registration for **Accounts in this organizational directory only**. Add a **Web** redirect URI of `https://YOUR-APP-HOST/auth/microsoft/callback`. Do not select SPA or enable implicit token grants. The application uses authorization code flow with PKCE and server-side client authentication.
3. Record the Directory (tenant) ID and Application (client) ID. Create an app client secret, store it through secure environment settings, and arrange rotation before it expires. Never commit or paste the secret into chat. Configure:

   | Variable | Purpose |
   | --- | --- |
   | `MS_TENANT_ID` | School directory GUID |
   | `MS_CLIENT_ID` | App registration GUID |
   | `MS_CLIENT_SECRET` | Secret supplied securely to the server |
   | `APP_ORIGIN` | Exact public HTTPS origin |
   | `NODE_ENV` | `production` for secure cookies and HTTPS enforcement |
   | `ATTENDANCE_DB_PATH` | Database location on a durable, restricted volume; default `.local/attendance.sqlite` |

4. In the app registration, define app roles for users/groups with exact **values** `Attendance.Admin` and `Attendance.Staff`. Enable them. In Enterprise applications, require assignment and assign authorized school staff/groups to the appropriate role. This app requests only `openid`, not student directories or Microsoft Graph. Consent must follow your school's tenant policy.
5. Allow server HTTPS access to `login.microsoftonline.com`. `npm start` uses Node's environment-proxy support, preserving TLS verification. Public browser access to Microsoft's sign-in resources is handled through your school network.
6. Restart the application after setting its configuration. Sign in as an assigned staff member, save a fictional attendance row, reload, and verify the row persists. Check that an unassigned school user and an external-tenant account cannot access it. Remove the test row before entering approved data.

The server validates JWT signatures with Microsoft's tenant key set, issuer, audience, tenant, nonce, time bounds, and assigned roles. Sessions expire after eight hours, use hashed tokens in SQLite, and use HttpOnly, SameSite cookies (`Secure` in production). Login state is short-lived and cookie-bound. No passwords or identity tokens are sent to the browser. The local user table stores the opaque Microsoft object ID and application role, not staff profile names or email addresses. Removing an Entra assignment prevents new sign-ins; existing app sessions remain valid for up to eight hours. For urgent revocation, administrators must revoke the relevant application sessions in the database or stop the service. All assigned staff currently have access to all divisions; division-scoped permissions are not implemented.

Official reference: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow

## Student privacy and CSV handling

The authenticated staff register intentionally stores first name plus last initial, registration number, and optional written absence notes, as requested. These are identifying/sensitive personal data, not anonymous records. All assigned Attendance.Staff and Attendance.Admin users can view the register across divisions. Leadership emails contain only division aggregates. Coded attendance CSV exports omit display names, registration numbers, and written notes; they retain internal codes, grades, dates, attendance statuses, and reason codes, and therefore remain sensitive pseudonymous data rather than anonymous exports.

Roster CSV columns: `display_name,registration_number,grade`. Use a display name such as `Ava R.`: first name(s) followed by one last initial, not a full last name. Registration numbers are stored as text, with leading zeros preserved. Names, registration numbers, and grade are intentionally retained in the shared staff roster; unrecognized columns such as email or phone are removed in the browser. New internal codes are generated independently using cryptographic randomness. Re-importing the same registration number updates that student while retaining the internal code and historical records. Legacy `student_code,grade` CSVs remain supported; include `student_code` alongside the new identity columns to link old coded history. Conflicting identity links are rejected. Legacy rows without identities show “Identity not entered.” The system does not merge different existing student identities automatically.

Attendance CSV columns: `date,student_code,grade,division,status`, with optional `reason` and `note`. Dates use `YYYY-MM-DD`. Status is `present`, `absent`, `leave`, or `late`. Absence reasons use `illness`, `appointment`, `family`, `authorized`, or `unexplained`, and apply only to absent records. An optional staff note is limited to 1,000 characters and applies only to absence. Notes are stored as written, rendered as escaped text, and are not automatically scrubbed for personal or medical information. Keep only the context needed for attendance follow-up. A status change from absent to present, leave, or late clears its reason and note. The absence dialog supports editing the existing reason/note. The action audit records operations and counts, not a history of previous note versions.

Notes and reason descriptions remain in staff histories; neither appears in leadership email drafts. Notes are also excluded from coded CSV exports, so these exports are not complete backups of identity or note data. Back up the protected SQLite database to preserve the full staff register. Raw uploaded CSV files stay in the browser; only the supported, validated fields reach the API. Export Excel worksheets to UTF-8 CSV. CSV imports are capped at 5 MB, attendance batches at 30,000 records, and roster batches at 10,000 students.

Unrecorded roster students are not automatically marked present; the bulk-present action explicitly confirms the number being marked and preserves existing absences and other statuses. Leadership drafts withhold divisions below five recorded students. Small cells in larger divisions can still permit inference; this threshold reduces risk rather than guaranteeing anonymity. Review all drafts and recipients before manually sending. Generated `.eml` files can be opened in compatible email clients; automatic sending and email-provider permissions are not used. Sign-out clears names, registration searches, and note input fields from the local view.

## Storage and deployment responsibilities

The default SQLite database is in `.local/attendance.sqlite`, excluded from Git, with a private directory and file permissions. SQLite provides a safe shared transactional source of truth for one application instance; CSV remains the import/export interchange format. Sharing a live CSV/Excel file as the database would risk concurrent-write corruption. The database records update authors/timestamps and an action audit without logging source files, passwords, or student identities.

Use an encrypted durable volume, restrict host access, set an approved retention policy, and arrange encrypted backups before using real student data. Database encryption, hosting, backup scheduling, school policy approval, and production deployment are not supplied automatically. For a consistent backup, use SQLite's online backup API or stop the service and preserve the database with its WAL/SHM files together. Do not copy only the SQLite main file while writes are active. Test restoration. Run one application instance per database volume; scale-out and directory-wide roster integration are outside this version.

The app loads shared history at sign-in and after its own writes. A browser refresh retrieves changes made by another staff member; real-time synchronization is not implemented. Sign-out clears the local working view and revokes that browser session without deleting saved records. Removing a day's record is an explicit shared database deletion. Exported files stay on the staff device and must be handled under school policy.

## Local development tests without a Microsoft tenant

The application defaults to Microsoft authentication and fails closed when configuration is absent. Developers can opt into loopback-only password authentication with `ATTENDANCE_LOCAL_AUTH=1`, using a **separate disposable database** and no real school data. The first local sign-in provisions a test administrator with a minimum 12-character password. Never enable this mode in school deployment. Production blocks local initial setup; Microsoft configuration overrides local authentication. Unit/integration tests use isolated temporary SQLite databases, fictional accounts, and locally signed mock identity tokens; they do not contact Microsoft or create real staff accounts.

## Secretary workflow

Sign in as assigned school staff and open **Secretary entry**. Select the reporting date and grade. In **Enter student counts**, fill in the student count and exception counts, check calculated present, and save. In **Mark individual students**, enter first name + last initial and registration number, or import the named staff roster, then click **Absent** to select a predefined reason and optionally add a written note. Grade division is automatic. Names, registration numbers, reason descriptions, and written notes are staff-only and never appear in leadership drafts. Names, registration numbers, and written notes are also omitted from coded CSV exports.

If saved grade counts exist, clear them before individual marking. If individual attendance already exists for that grade/date, counts are blocked and the individual register should be completed instead. These restrictions apply across imports and API writes, not only the interface. Saved counts and rosters persist in SQLite alongside individual history. Database startup migrates older tables by adding absence-reason and note columns and staff roster identity columns, preserving existing records and seeding legacy coded rosters from the latest historical grade. Old absent entries become unexplained; identity fields and notes remain blank until entered. Back up the database before upgrading a live installation.
