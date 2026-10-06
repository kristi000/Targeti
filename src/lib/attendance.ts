import type { z } from "zod";
import type { attendanceDaySchema, attendanceEntrySchema, attendanceMonthConfigSchema, attendanceStaffSchema } from "@/lib/persistence-schemas";

export type AttendanceStaff = z.infer<typeof attendanceStaffSchema>;
export type AttendanceEntry = z.infer<typeof attendanceEntrySchema>;
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;
export type AttendanceConfig = z.infer<typeof attendanceMonthConfigSchema>;
export type AttendanceMonth = { config: AttendanceConfig; days: AttendanceDay[] };
export const attendanceQueryKey = (shopId: string, month: string) => ["attendance", shopId, month] as const;
export const ATTENDANCE_CODES = ["1", "2", "1+2", "P", "LV", "R", "OTHER"] as const;
export function monthDates(month: string) {
  const [year, number] = month.split("-").map(Number);
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
export function attendanceText(entry?: AttendanceEntry) {
  if (!entry) return "";
  return entry.originalText ?? (entry.code === "OTHER" ? entry.note : entry.note ? `${entry.code} ${entry.note}` : entry.code === "1+2" ? "1   2" : entry.code);
}
export function parseAttendanceText(staffId: string, text: string): AttendanceEntry | null {
  const originalText = text;
  const normalized = text.trim().toUpperCase();
  if (!normalized) return null;
  if (/^1\s+2$/.test(normalized) || normalized === "1+2") return { staffId, code: "1+2", note: "", originalText };
  if ((ATTENDANCE_CODES as readonly string[]).includes(normalized) && normalized !== "OTHER") return { staffId, code: normalized as AttendanceEntry["code"], note: "", originalText };
  const turn = text.trim().match(/^([12])\s+(.+)$/);
  return { staffId, code: turn ? turn[1] as "1" | "2" : "OTHER", note: turn ? turn[2] : text.trim(), originalText };
}
