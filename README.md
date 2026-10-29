# Attend — School Attendance & Executive Dashboard

A React + TypeScript school attendance workspace for secretaries, teachers, division heads, and school leadership. This review implements the core structure from the uploaded **Business Case & Engineering Specification Document**, while keeping the previously agreed identity, privacy, division, and email-review requirements.

**Start your review with [the specification review guide](docs/SPECIFICATION_REVIEW.md).** It maps implemented features, deliberate differences, acceptance checks, and future work.

## Try it in GitHub Codespaces

1. Select the `attendance-platform-review` branch on GitHub.
2. Choose **Code → Codespaces → Create codespace on this branch**.
3. In the terminal:

   ```sh
   nvm install 24
   nvm use 24
   npm ci
   npm start
   ```

4. Open port **3000** from **Ports** and keep it **Private**.
5. Click **Explore fictional demo**. Microsoft setup is not needed for the demo.

The demo uses 120 fictional students, four divisions, classes and houses, and a month of records. All demo changes stay in browser memory. All demo artifacts are labeled fictional.

## Review the workspaces

- **Secretary:** choose a grade, enter counts or mark students, record absences and late arrivals, confirm parent contact, and verify/finalize the daily register.
- **Teacher:** focused assigned-class roll call; mark unrecorded students present without overwriting existing exceptions.
- **Division head:** grade/class/house filters and named early-warning follow-ups within the assigned division.
- **Head of school:** institutional KPIs, the monthly calendar, and aggregate leadership exports. Real executive API responses do not contain student identities or notes.

Press **Ctrl+K / ⌘K** to find a student, **Esc** to dismiss, and **Ctrl+Enter / ⌘Enter** to save the attendance dialog. Parent contact confirmation records a contact already made; it sends no messages. Muster view shows recorded statuses and unmarked students, not a guarantee of live campus occupancy.

## Run and develop

Node.js **24.5+** is required. The tested runtime is 24.19.

```sh
npm ci
npm run lint       # strict TypeScript check
npm test           # domain, API authorization, persistence, identity, analytics, reporting
npm run build      # TypeScript check + production frontend
npm start          # builds and starts the application on loopback port 3000
```

Optional browser checks: `npm run test:browser`. Install Chromium using `npx playwright install chromium` if no system browser is available; see the review guide for isolated test details.

For an existing build use `npm run serve`. For hot-reload development, run `npm run serve` in one terminal and `npm run dev` in another; Vite proxies API/auth requests to port 3000. Do not expose the development server publicly.

## Privacy and school deployment

The authenticated staff database stores first name + last initial, registration number, and optional written attendance notes. These are personal data, not anonymous records. Student registration numbers remain text, including leading zeros; internal student codes are generated independently.

Leadership HTML/EML, PDF/PNG, and Excel exports contain aggregates only. They omit names, registration numbers, reason descriptions and staff notes. Legacy coded CSV helpers remain available for interchange; coded records are pseudonymous, not anonymous. No student data or pending mutations are written to local storage. Offline roll-call writes are buffered in memory and retried, so keep the tab open until saved.

School sign-in requires a Microsoft Entra registration, assigned application roles and scopes, an HTTPS deployment, and secure environment settings. Live Microsoft sign-in, school Outlook clients, production hosting, encrypted storage/backups, and compliance acceptance are still external prerequisites.

See [SETUP.md](SETUP.md) for deployment, Microsoft roles, imports, calculations, permissions, and retention limitations. GitHub Pages cannot run the application backend.
