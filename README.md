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
5. Click **Explore with fictional data**. Review division summaries, filter students by grade, expand absence histories, and download a division email draft.

The demo needs no Microsoft registration. Its fictional records stay in browser memory and never enter the shared database. Use fictional data while evaluating.

## School deployment

Microsoft school sign-in requires an Entra app registration, assigned staff roles, secure configuration, and an HTTPS deployment. It is implemented but has not been validated against a real school tenant. Without configuration, real attendance access remains locked.

Student histories use pseudonymous codes, not full anonymization. Raw CSV files stay in the browser; extra personal fields are discarded before coded records reach the server. Shared attendance is stored in SQLite, with CSV import/export. Excel files must first be exported to CSV.

See [SETUP.md](SETUP.md) for Microsoft setup, grade mappings, privacy boundaries, storage, and production requirements. GitHub Pages cannot run the application server.
