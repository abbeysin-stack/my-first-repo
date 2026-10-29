# Attend — school attendance workspace

A shared school attendance application with Microsoft Entra staff sign-in, a SQLite database, grade-level entry, coded student absence histories, CSV interchange, and formatted leadership email drafts. Node.js 24.5+ is required (validated on 24.19). No npm dependencies or build step are required.

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

Division is derived from grade on entry and verified on CSV import and server writes. One student/date has one attendance record; later saves update it. CSV imports reject duplicate student/date rows within a file. Present ÷ all recorded students is the attendance rate. Absent, leave, and late are separate; late is the supported exception category. Unrecorded students cannot be inferred without a roster, so the report describes recorded headcount rather than total enrollment.

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

Use random opaque student codes such as `S-A7K9M2Q4` (prefix `S-`, followed by 6–16 uppercase letters/digits). Never derive codes from names, initials, dates of birth, or admission numbers. Keep the identity-to-code mapping outside this application in the school's approved student information system. The application cannot determine whether a syntactically valid code or division label embeds identifying information: this remains an input policy, not a guaranteed automatic anonymizer.

CSV columns: `date,student_code,grade,division,status`. Dates use `YYYY-MM-DD`. Status is `present`, `absent`, `leave`, or `late`. Export Excel worksheets to UTF-8 CSV. Extra fields such as names, phone numbers, notes, and email addresses are removed **in the browser**, before API requests. The server rejects extra record fields and validates the allowlisted schema again. Raw files are never uploaded. There is no free-text student-notes field. CSV imports are capped at 5 MB and server batches at 30,000 records.

Coded attendance histories are **pseudonymous and sensitive**, not anonymous. They are centrally stored and included in coded CSV exports, but never included in leadership drafts. Leadership drafts contain division aggregates only, with divisions below five students withheld. Small cells in larger divisions can still permit inference; this threshold is risk reduction rather than a guarantee of anonymity. Review all drafts and recipients before manually sending. Generated `.eml` drafts can be opened in compatible email clients; no automatic email sending or email-provider permissions are used.

## Storage and deployment responsibilities

The default SQLite database is in `.local/attendance.sqlite`, excluded from Git, with a private directory and file permissions. SQLite provides a safe shared transactional source of truth for one application instance; CSV remains the import/export interchange format. Sharing a live CSV/Excel file as the database would risk concurrent-write corruption. The database records update authors/timestamps and an action audit without logging source files, passwords, or student identities.

Use an encrypted durable volume, restrict host access, set an approved retention policy, and arrange encrypted backups before using real student data. Database encryption, hosting, backup scheduling, school policy approval, and production deployment are not supplied automatically. For a consistent backup, use SQLite's online backup API or stop the service and preserve the database with its WAL/SHM files together. Do not copy only the SQLite main file while writes are active. Test restoration. Run one application instance per database volume; scale-out and directory-wide roster integration are outside this version.

The app loads shared history at sign-in and after its own writes. A browser refresh retrieves changes made by another staff member; real-time synchronization is not implemented. Sign-out clears the local working view and revokes that browser session without deleting saved records. Removing a day's record is an explicit shared database deletion. Exported files stay on the staff device and must be handled under school policy.

## Local development tests without a Microsoft tenant

The application defaults to Microsoft authentication and fails closed when configuration is absent. Developers can opt into loopback-only password authentication with `ATTENDANCE_LOCAL_AUTH=1`, using a **separate disposable database** and no real school data. The first local sign-in provisions a test administrator with a minimum 12-character password. Never enable this mode in school deployment. Production blocks local initial setup; Microsoft configuration overrides local authentication. Unit/integration tests use isolated temporary SQLite databases, fictional accounts, and locally signed mock identity tokens; they do not contact Microsoft or create real staff accounts.
