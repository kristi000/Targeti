"use server";
import { loadAttendanceMonth, saveAttendance, attendanceChangesSchema } from "@/lib/server/attendance";
import { z } from "zod";
import type { AttendanceStaff } from "@/lib/attendance";
import { attendanceMonthSchema, attendanceRosterSchema, shopIdSchema } from "@/lib/persistence-schemas";

const attendanceSaveSchema = z.object({
  shopId: shopIdSchema, month: attendanceMonthSchema, expectedRevision: z.number().int().nonnegative(),
  staff: attendanceRosterSchema.optional(), changes: attendanceChangesSchema,
}).strict();

export async function fetchAttendanceMonth(shopId: string, month: string) {
  return loadAttendanceMonth(shopId, month);
}
export async function handleSaveAttendance(input: { shopId: string; month: string; expectedRevision: number; staff?: AttendanceStaff[]; changes: z.infer<typeof attendanceChangesSchema> }) {
  try { return { success: true as const, data: await saveAttendance(attendanceSaveSchema.parse(input)) }; }
  catch (error) {
    const known = ["conflict", "locked", "lockedRoster", "staffInUse", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    return { success: false as const, error: error instanceof Error && known.includes(error.message) ? error.message : "saveFailed" };
  }
}
