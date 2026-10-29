export type Persona = "secretary" | "teacher" | "division" | "executive";
export type Status =
  | "present"
  | "absent"
  | "late"
  | "leave"
  | "excused"
  | "half_day";
export interface Student {
  student_code: string;
  display_name?: string;
  registration_number?: string;
  grade: string;
  class_name?: string;
  house?: string;
}
export interface Attendance {
  date: string;
  student_code: string;
  grade: string;
  division: string;
  status: Status;
  reason?: string;
  note?: string;
  parent_notified?: boolean;
  arrival_time?: string;
  class_name?: string;
  house?: string;
}
export interface Counts {
  present: number;
  absent: number;
  late: number;
  leave: number;
  excused: number;
  half_day: number;
}
export interface Totals extends Counts {
  date: string;
  grade: string;
  total: number;
}
export interface Metric extends Counts {
  date: string;
  division: string;
}
export interface Finalized {
  date: string;
  grade: string;
  finalized_at: string;
  finalized_by: number;
}
export interface User {
  id: number;
  username: string;
  role: "admin" | "staff";
  persona: Persona;
  scope_division: string;
  assigned_class: string;
}
export interface Dataset {
  expectedGrades?: string[];
  records: Attendance[];
  roster: Student[];
  totals: Totals[];
  metrics: Metric[];
  enrollment: { division: string; total: number }[];
  finalized: Finalized[];
  calendar: { date: string; label: string }[];
  recordMeta: {
    date: string;
    student_code: string;
    recordedBy: number;
    recordedAt: string;
  }[];
  serverTime: string;
}
export interface Session {
  user: User | null;
  authMode: "microsoft" | "local";
  setupRequired: boolean;
  microsoftConfigured: boolean;
}
export interface Risk {
  student: Student;
  rate: number;
  days: number;
  absences: number;
  consecutive: number;
  level: "chronic" | "consecutive";
}
export const statuses: Status[] = [
  "present",
  "absent",
  "late",
  "excused",
  "half_day",
  "leave",
];
export const labels: Record<Status, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
  half_day: "Half-day",
  leave: "On leave",
};
export const reasons: Record<string, string> = {
  illness: "Medical / illness",
  family: "Family emergency",
  school_event: "School event / sports",
  religious: "Religious holiday",
  visa: "Visa / passport appointment",
  appointment: "Appointment",
  authorized: "Authorized absence",
  unexplained: "Unexcused / unexplained",
  other: "Other",
};
