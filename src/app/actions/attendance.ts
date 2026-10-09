"use server";
import { loadAttendanceMonth, saveAttendance, attendanceChangesSchema, loadAttendanceHistory, loadAttendanceHistoryDetails, reuseAttendanceTemplate, reuseAttendanceTemplateSchema } from "@/lib/server/attendance";
import { z } from "zod";
import { measureServerOperation } from "@/lib/server/performance";
import type { AttendanceStaff } from "@/lib/attendance";
import { attendanceMonthSchema, attendanceRosterSchema, shopIdSchema } from "@/lib/persistence-schemas";

const attendanceSaveSchema = z.object({
  shopId: shopIdSchema, month: attendanceMonthSchema, expectedRevision: z.number().int().nonnegative(),
  staff: attendanceRosterSchema.optional(), changes: attendanceChangesSchema,
}).strict();

export async function fetchAttendanceMonth(shopId: string, month: string) {
  return measureServerOperation("attendance.month", () => loadAttendanceMonth(shopId, month));
}
export async function fetchAttendanceHistory(shopId: string, month: string, cursor?: string) {
  return loadAttendanceHistory(shopId, month, cursor);
}
export async function fetchAttendanceHistoryDetails(shopId: string, month: string, historyId: string) {
  return loadAttendanceHistoryDetails(shopId, month, historyId);
}
export async function handleSaveAttendance(input: { shopId: string; month: string; expectedRevision: number; staff?: AttendanceStaff[]; changes: z.infer<typeof attendanceChangesSchema> }) {
  try { return { success: true as const, data: await saveAttendance(attendanceSaveSchema.parse(input)) }; }
  catch (error) {
    const known = ["conflict", "staffInUse", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    return { success: false as const, error: error instanceof Error && known.includes(error.message) ? error.message : "saveFailed" };
  }
}

export async function handleReuseAttendanceTemplate(input: z.infer<typeof reuseAttendanceTemplateSchema>) {
  try { return { success: true as const, data: await reuseAttendanceTemplate(reuseAttendanceTemplateSchema.parse(input)) }; }
  catch (error) {
    const known = ["conflict", "noTemplate", "templateCapacity", "invalidTemplate", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    return { success: false as const, error: error instanceof Error && known.includes(error.message) ? error.message : "saveFailed" };
  }
}
