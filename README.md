# Attend — school attendance

Grade-level student attendance, coded absence histories, and leadership email drafts for Junior School (PYP), Junior School (MYP), Secondary (IGCSE), and Secondary (IB DP).

## Try the fictional demo in GitHub Codespaces

1. On GitHub, select the branch containing this application.
2. Choose **Code → Codespaces → Create codespace on this branch**.
3. In the Codespaces terminal, run:

   ```sh
   nvm install 24
   nvm use 24
   npm test
   npm start
   ```

4. In **Ports**, open port **3000** in your browser and keep visibility **Private**. If it is absent, choose **Add port** and enter `3000`.
5. Click **Explore with fictional data**.
6. Open **Secretary entry**. Grade 1 demonstrates saved **student counts**. Change counts and save to update the division summary and email.
7. Choose **Grade 2 → Mark individual students**. Click **Absent** beside a student, select an absence description, and save. Click **Present**, **Leave**, or **Late** to correct a status.
8. Review division summaries, filter absence histories, and download a division email draft. Reasons and student codes stay out of leadership emails.

The demo needs no Microsoft registration. Its fictional records stay in browser memory and never enter the shared database. Use fictional data while evaluating.

## School deployment

Microsoft school sign-in requires an Entra app registration, assigned staff roles, secure configuration, and an HTTPS deployment. It is implemented but has not been validated against a real school tenant. Without configuration, real attendance access remains locked.

Student histories use pseudonymous codes, not full anonymization. Raw CSV files stay in the browser; extra personal fields are discarded before coded records reach the server. Shared attendance is stored in SQLite, with CSV import/export. Excel files must first be exported to CSV.

See [SETUP.md](SETUP.md) for Microsoft setup, grade mappings, privacy boundaries, storage, and production requirements. GitHub Pages cannot run the application server.

## Secretary entry

For each grade and date, secretaries choose one method:

- **Counts:** enter student count, absent, on leave, and late. Present is calculated. Counts feed division reporting without creating individual student histories.
- **Individual register:** add coded students or import a roster with `student_code,grade`, then click a status beside each student. Marking absent opens a description selector: illness, appointment, family reason, authorized absence, or unexplained. `Mark unrecorded students present` requires confirmation and preserves existing absences.

The app prevents counts and individual attendance from being saved for the same grade/date. Clear saved counts before switching to individual marking. If individual records already exist, continue using that register. Existing student attendance imports also populate the roster. Counts have a separate CSV export; coded attendance CSVs include the optional allowlisted `reason` column. Free-text personal or medical notes are not accepted.
