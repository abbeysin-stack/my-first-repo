import { useEffect, useState } from "react";
import type { Platform } from "../usePlatform";
import { request } from "../usePlatform";
import type { User, Persona } from "../types";
import { schoolDivisions } from "../../src/students.js";
export function Settings({ platform }: { platform: Platform }) {
  const [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState(""),
    [persona, setPersona] = useState<Persona>("teacher"),
    [division, setDivision] = useState(schoolDivisions[0]),
    [className, setClass] = useState(""),
    [day, setDay] = useState(""),
    [label, setLabel] = useState("");
  useEffect(() => {
    if (!platform.demo)
      request<{ users: User[] }>("/api/users")
        .then((r) => setUsers(r.users))
        .catch((e) => setError(e.message));
  }, [platform.demo]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h2>Staff access and school calendar</h2>
          <p>
            View changes never grant permissions. Role and class scopes are
            enforced by the server.
          </p>
        </div>
      </div>
      <div className="panel-body settings-grid">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (platform.demo) {
                setMessage(
                  "Fictional review only. No actual staff permissions were changed.",
                );
                return;
              }
              await request("/api/access", "PATCH", {
                id: Number(selected),
                persona,
                scope_division: division,
                assigned_class: className,
              });
              setMessage(
                "Access updated. That staff member must sign in again.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h3>Assign staff scope</h3>
          <label>
            Staff account
            <select
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose an account</option>
              {users
                .filter((u) => u.role !== "admin")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} · {u.persona}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Workspace role
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as Persona)}
            >
              <option value="secretary">Secretary</option>
              <option value="teacher">Teacher</option>
              <option value="division">Division head</option>
              <option value="executive">Head of school / executive</option>
            </select>
          </label>
          {persona === "teacher" && (
            <label>
              Assigned homeroom class
              <input
                value={className}
                required
                maxLength={60}
                placeholder="10-A"
                onChange={(e) => setClass(e.target.value)}
              />
            </label>
          )}
          {persona === "division" && (
            <label>
              Assigned division
              <select
                value={division}
                onChange={(e) => setDivision(e.target.value)}
              >
                {schoolDivisions.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          )}
          <button className="button primary">Save access scope</button>
          <p className="field-note">
            Microsoft users appear after first sign-in. A teacher without an
            assigned class sees no roster; a division head without a division
            sees no students. Entra app-role claims take precedence at
            subsequent sign-in.
          </p>
        </form>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (platform.demo) {
                setMessage(
                  "Calendar setup is available for authenticated administrators.",
                );
                return;
              }
              await request("/api/calendar", "POST", { date: day, label });
              await platform.refresh();
              setMessage(
                "Non-instructional date saved. Heatmap and streak calculations updated.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h3>Non-instructional dates</h3>
          <label>
            Date
            <input
              type="date"
              required
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>
            Label
            <input
              required
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="School holiday"
            />
          </label>
          <button className="button secondary">Save closed date</button>
          <ul className="calendar-list">
            {platform.data.calendar.map((d) => (
              <li key={d.date}>
                {d.date} · {d.label}
              </li>
            ))}
          </ul>
          <p className="field-note">
            Weekends are neutral by default. This calendar excludes holidays
            from consecutive-absence streaks and the monthly view.
          </p>
        </form>
      </div>
      {error && (
        <p role="alert" className="error-text panel-body">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="panel-body">
          {message}
        </p>
      )}
    </section>
  );
}
