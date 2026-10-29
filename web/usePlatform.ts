import { useCallback, useEffect, useRef, useState } from "react";
import type { Attendance, Dataset, Session, Student, Totals } from "./types";
import { emptyData, demoData } from "./lib/demo";
class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await res.json()) as T & { error?: string };
  if (!res.ok)
    throw new RequestError(result.error || "Request failed.", res.status);
  return result;
}
function merge(records: Attendance[], incoming: Attendance[]) {
  const map = new Map(records.map((r) => [r.date + "|" + r.student_code, r]));
  for (const r of incoming) map.set(r.date + "|" + r.student_code, r);
  return [...map.values()];
}
export function usePlatform(date: string) {
  const [session, setSession] = useState<Session | null>(null),
    [data, setData] = useState<Dataset>(emptyData),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(0),
    [lastSync, setLastSync] = useState("");
  const queue = useRef<Attendance[][]>([]),
    pumping = useRef(false),
    retryRequested = useRef(false),
    epoch = useRef(0),
    dataRef = useRef(data);
  dataRef.current = data;
  const clear = useCallback(() => {
    epoch.current++;
    queue.current = [];
    setPending(0);
    setData(emptyData());
    setDemo(false);
    setSession((s) => (s ? { ...s, user: null } : s));
  }, []);
  const refresh = useCallback(async () => {
    const current = epoch.current;
    try {
      const next = await request<Dataset>("/api/records");
      if (epoch.current !== current) return;
      setData({ ...next, records: merge(next.records, queue.current.flat()) });
      setLastSync(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) {
        clear();
        setError("Your session expired. Please sign in again.");
      } else throw e;
    }
  }, [clear]);
  useEffect(() => {
    let active = true;
    request<Session>("/api/session")
      .then(async (result) => {
        if (!active) return;
        setSession(result);
        if (result.user) await refresh();
      })
      .catch(() =>
        setError("The attendance service is unavailable. Please retry."),
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const pump = useCallback(async (): Promise<void> => {
    if (demo || !session?.user || !queue.current.length) return;
    if (pumping.current) {
      retryRequested.current = true;
      return;
    }
    pumping.current = true;
    retryRequested.current = false;
    const current = epoch.current;
    try {
      while (queue.current.length && epoch.current === current) {
        try {
          await request("/api/records", "POST", { records: queue.current[0] });
          if (epoch.current !== current) return;
          queue.current.shift();
          setPending(queue.current.flat().length);
          setError("");
        } catch (e) {
          if (e instanceof RequestError) {
            setError(
              e.message +
                " Your changes remain pending; resolve the conflict or discard them.",
            );
            if (e.status === 401) clear();
          } else
            setNotice(
              "Connection interrupted. Attendance is buffered in memory and will retry when connected. Keep this tab open.",
            );
          break;
        }
      }
      if (epoch.current === current) await refresh().catch(() => {});
    } finally {
      pumping.current = false;
      if (
        retryRequested.current &&
        queue.current.length &&
        epoch.current === current
      ) {
        retryRequested.current = false;
        queueMicrotask(() => void pump());
      }
    }
  }, [demo, session?.user, refresh, clear]);
  useEffect(() => {
    if (demo || !session?.user) return;
    const source = new EventSource("/api/events");
    source.onmessage = () => void refresh().catch(() => {});
    const interval = setInterval(() => {
      if (!document.hidden) {
        void pump();
        void refresh().catch(() => {});
      }
    }, 10000);
    const online = () => void pump();
    window.addEventListener("online", online);
    return () => {
      source.close();
      clearInterval(interval);
      window.removeEventListener("online", online);
    };
  }, [demo, session?.user, refresh, pump]);
  useEffect(() => {
    if (!pending) return;
    const protect = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [pending]);
  const save = async (incoming: Attendance[]) => {
    if (!incoming.length) return;
    for (const r of incoming) {
      if (
        dataRef.current.finalized.some(
          (f) => f.date === r.date && f.grade === r.grade,
        )
      )
        throw Error(
          "This grade register is finalized. An administrator must reopen it.",
        );
      if (
        dataRef.current.totals.some(
          (t) => t.date === r.date && t.grade === r.grade,
        )
      )
        throw Error(
          "Clear the grade counts before marking individual students.",
        );
    }
    setData((prev) => ({ ...prev, records: merge(prev.records, incoming) }));
    if (demo) {
      setNotice(
        "Fictional attendance updated. Nothing was sent to the shared database.",
      );
      return;
    }
    queue.current.push(incoming);
    setPending(queue.current.flat().length);
    setNotice("Saving attendance…");
    await pump();
    if (!queue.current.length)
      setNotice("Attendance saved. All workspaces are up to date.");
  };
  const mutation = async (path: string, method: string, body: unknown) => {
    setError("");
    await request(path, method, body);
    await refresh();
  };
  return {
    session,
    data,
    demo,
    busy,
    error,
    notice,
    pending,
    lastSync,
    setError,
    setNotice,
    refresh,
    pump,
    save,
    async saveRoster(students: Student[]) {
      if (demo) {
        setData((prev) => {
          const map = new Map(prev.roster.map((s) => [s.student_code, s]));
          for (const s of students) {
            const existing = prev.roster.find(
              (r) =>
                s.registration_number &&
                r.registration_number === s.registration_number,
            );
            const code =
              existing?.student_code ||
              s.student_code ||
              "S-" +
                crypto
                  .randomUUID()
                  .replaceAll("-", "")
                  .slice(0, 16)
                  .toUpperCase();
            map.set(code, { ...s, student_code: code });
          }
          return { ...prev, roster: [...map.values()] };
        });
        return;
      }
      await mutation("/api/roster", "POST", { students });
    },
    async saveTotals(value: Totals) {
      const { present, ...payload } = value;
      if (demo) {
        if (
          data.records.some(
            (r) => r.date === value.date && r.grade === value.grade,
          )
        )
          throw Error("Individual attendance exists for this grade/date.");
        setData((prev) => ({
          ...prev,
          totals: prev.totals
            .filter((t) => !(t.date === value.date && t.grade === value.grade))
            .concat(value),
        }));
        return;
      }
      await mutation("/api/totals", "POST", payload);
    },
    async clearTotals(grade: string) {
      if (demo)
        setData((prev) => ({
          ...prev,
          totals: prev.totals.filter(
            (t) => !(t.date === date && t.grade === grade),
          ),
        }));
      else await mutation("/api/totals", "DELETE", { date, grade });
    },
    async finalize(grades: string[]) {
      for (const grade of grades) {
        if (!data.totals.some((t) => t.date === date && t.grade === grade)) {
          const students = data.roster.filter((s) => s.grade === grade);
          if (
            !students.length ||
            students.some(
              (s) =>
                !data.records.some(
                  (r) =>
                    r.date === date &&
                    r.student_code === s.student_code &&
                    r.grade === grade,
                ),
            )
          )
            throw Error(
              `Grade ${grade} has unmarked students. Complete the register first.`,
            );
        }
      }
      if (pending)
        throw Error("Save or discard pending changes before finalizing.");
      if (demo) {
        setData((prev) => ({
          ...prev,
          finalized: [
            ...prev.finalized.filter(
              (f) => !(f.date === date && grades.includes(f.grade)),
            ),
            ...grades.map((grade) => ({
              date,
              grade,
              finalized_by: 0,
              finalized_at: new Date().toISOString(),
            })),
          ],
        }));
        return;
      }
      await mutation("/api/finalize", "POST", { date, grades });
    },
    async reopen(grade: string) {
      if (demo)
        setData((prev) => ({
          ...prev,
          finalized: prev.finalized.filter(
            (f) => !(f.date === date && f.grade === grade),
          ),
        }));
      else await mutation("/api/finalize", "DELETE", { date, grade });
    },
    async login(username: string, password: string) {
      const result = await request<{ user: NonNullable<Session["user"]> }>(
        session?.setupRequired ? "/api/setup" : "/api/login",
        "POST",
        { username, password },
      );
      setSession((prev) => (prev ? { ...prev, user: result.user } : null));
      await refresh();
    },
    async logout() {
      if (pending && !confirm("Discard unsaved attendance and sign out?"))
        return;
      try {
        if (session?.user) await request("/api/logout", "POST", {});
        clear();
      } catch {
        clear();
        setError(
          "The local view was cleared, but server sign-out could not be confirmed. Reconnect and sign out again before leaving a shared device.",
        );
      }
    },

    startDemo() {
      epoch.current++;
      queue.current = [];
      setPending(0);
      setDemo(true);
      setData(demoData(date));
      setError("");
      setNotice(
        "Fictional review workspace. No real student data and no outgoing messages.",
      );
    },
    async discard() {
      queue.current = [];
      setPending(0);
      setError("");
      await refresh();
      setNotice("Pending changes discarded. Reloaded the saved register.");
    },
  };
}
export type Platform = ReturnType<typeof usePlatform>;
