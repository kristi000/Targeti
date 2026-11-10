import "server-only";

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";

import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { closingWorkbookContentDisposition, closingWorkbookFormatSchema, closingYearSchema } from "@/lib/annual-closing";
import { exportAttendanceWorkbook, inspectAttendanceWorkbook, MAX_ATTENDANCE_FILE_BYTES, normalizeAttendanceName, workbookAttendanceDays } from "@/lib/attendance-workbook";
import { adminDb as db } from "@/lib/firebase-admin";
import { attendanceMonthSchema, attendanceRosterSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { readProceduresWorkbook } from "@/lib/procedures-workbook";
import { generateAnnualClosingWorkbook } from "@/lib/server/annual-closing";
import { attendanceImportChanges, loadAttendanceMonth, loadAttendanceTemplate, saveAttendance } from "@/lib/server/attendance";
import { importProcedures, procedureImportSchema } from "@/lib/server/procedures";
import { hasValidRequestOrigin, privateHeaders } from "@/server/http";

const workbookHeaders = (contentDisposition: string) => ({
  "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "Content-Disposition": contentDisposition,
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
});

export const shopRoutes = new Hono();

// --- Attendance workbook import (POST) and export (GET) ---

const attendanceErrors = ["useMatchingSheet", "monthHasData", "fileTooLarge", "invalidTemplate", "conflict", "staffInUse", "noTemplate", "templateCapacity", "wrongShop", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];

function attendanceFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "requestFailed";
  const status = message === "UNAUTHENTICATED" ? 401 : message === "EDITOR_REQUIRED" || message === "SHOP_ACCESS_REQUIRED" ? 403 : 400;
  return Response.json({ error: attendanceErrors.includes(message) ? message : "requestFailed" }, { status });
}

const attendanceImportSchema = z.object({
  month: attendanceMonthSchema, sheet: z.string().min(1).max(31), expectedRevision: z.number().int().nonnegative(),
  staff: attendanceRosterSchema,
  mapping: z.array(z.object({ column: z.number().int().min(3).max(26), staffId: z.string().min(1).max(150) }).strict()).min(1).max(24),
  expectedDays: z.record(z.string(), z.string().datetime().nullable()).refine(days => Object.keys(days).length <= 31),
}).strict();

shopRoutes.post("/:shopId/attendance-template", async c => {
  try {
    const shopId = shopIdSchema.parse(c.req.param("shopId"));
    await requireEditorForShops([shopId]);
    if (!hasValidRequestOrigin(c)) return c.json({ error: "requestFailed" }, 403);
    if (Number(c.req.header("content-length")) > MAX_ATTENDANCE_FILE_BYTES + 100_000) throw new Error("fileTooLarge");
    const form = await c.req.formData();
    const mode = z.enum(["preview", "import"]).parse(form.get("mode"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > MAX_ATTENDANCE_FILE_BYTES) throw new Error("invalidTemplate");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sheets = inspectAttendanceWorkbook(bytes);
    const shopSnapshot = await db.collection("shops").doc(shopId).get();
    const shop = shopSchema.parse({ id: shopId, ...shopSnapshot.data() });
    if (sheets.some(sheet => normalizeAttendanceName(sheet.shopName) !== normalizeAttendanceName(shop.name))) throw new Error("wrongShop");
    if (mode === "preview") return c.json({ sheets });
    const input = attendanceImportSchema.parse(JSON.parse(String(form.get("input"))));
    const sheet = sheets.find(item => item.name === input.sheet);
    if (!sheet) throw new Error("invalidTemplate");
    if (sheet.month !== input.month && sheets.some(item => item.month === input.month)) throw new Error("useMatchingSheet");
    if (input.mapping.length !== sheet.staff.length || new Set(input.mapping.map(item => item.column)).size !== sheet.staff.length || new Set(input.mapping.map(item => item.staffId)).size !== sheet.staff.length || input.mapping.some(item => !sheet.staff.some(person => person.column === item.column) || !input.staff.some(person => person.id === item.staffId))) throw new Error("invalidTemplate");
    if (input.staff.some(person => !input.mapping.some(item => item.staffId === person.id))) throw new Error("templateCapacity");
    const loaded = await loadAttendanceMonth(shopId, input.month);
    if (loaded.config.revision !== input.expectedRevision) throw new Error("conflict");
    const importDays = sheet.month === input.month ? workbookAttendanceDays(sheet, input.mapping) : [];
    if (sheet.month !== input.month && loaded.days.length) throw new Error("monthHasData");
    const changes = attendanceImportChanges(input.month, importDays, loaded).map(change => ({
      ...change, expectedUpdatedAt: input.expectedDays[change.date] ?? null,
    }));
    const data = await saveAttendance({ shopId, month: input.month, expectedRevision: input.expectedRevision, staff: input.staff, changes,
      template: { id: randomUUID(), sheet: sheet.name, month: input.month, sourceMonth: sheet.month, fileName: file.name, columns: input.mapping },
      templateBytes: Buffer.from(bytes).toString("base64"),
    });
    return c.json({ data });
  } catch (error) { return attendanceFailure(error); }
});

shopRoutes.get("/:shopId/attendance-template", async c => {
  try {
    const shopId = shopIdSchema.parse(c.req.param("shopId"));
    await requireShopAccess(shopId);
    const month = attendanceMonthSchema.parse(c.req.query("month") ?? null);
    const loaded = await loadAttendanceMonth(shopId, month);
    const bytes = await loadAttendanceTemplate(shopId, loaded.config);
    const exported = exportAttendanceWorkbook(bytes, loaded);
    return c.body(new Uint8Array(exported), 200, workbookHeaders(`attachment; filename="attendance-${month}.xlsx"`));
  } catch (error) { return attendanceFailure(error); }
});

// --- Annual closing workbook export ---

const closingExportQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/).transform(Number).pipe(closingYearSchema),
  format: closingWorkbookFormatSchema,
});

shopRoutes.get("/:shopId/closing-workbook", async c => {
  try {
    const shopId = shopIdSchema.parse(c.req.param("shopId"));
    const { year, format } = closingExportQuerySchema.parse({ year: c.req.query("year") ?? null, format: c.req.query("format") ?? null });
    const { bytes, shopName } = await generateAnnualClosingWorkbook(shopId, year, format);
    return c.body(new Uint8Array(bytes), 200, workbookHeaders(closingWorkbookContentDisposition(format, shopName)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHENTICATED" ? 401
      : ["SHOP_ACCESS_REQUIRED", "RESTRICTED_ACCESS_REQUIRED"].includes(message) ? 403
      : message === "SHOP_NOT_FOUND" ? 404
      : error instanceof z.ZodError || message.startsWith("INVALID_") ? 400 : 500;
    if (status === 500) console.error("Closing workbook export failed:", error);
    const code = status === 400 ? "invalidData" : status === 401 ? "sessionExpired" : status === 403 ? "accessDenied" : "exportFailed";
    return c.json({ error: code }, status, privateHeaders);
  }
});

// --- Procedures workbook import ---

const procedureErrors = ["invalidWorkbook", "dateMismatch", "conflict", "alreadyImported", "notFound", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];

shopRoutes.post("/:shopId/procedures-import", async c => {
  try {
    const shopId = c.req.param("shopId");
    shopIdSchema.parse(shopId);
    await requireEditorForShops([shopId]);
    const origin = c.req.header("origin");
    const host = c.req.header("x-forwarded-host")?.split(",")[0].trim() ?? c.req.header("host");
    if (!origin || new URL(origin).host !== host) return c.json({ error: "importFailed" }, 403);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > 2 * 1024 * 1024) throw new Error("invalidWorkbook");
    const input = procedureImportSchema.parse(JSON.parse(String(form.get("input"))));
    const workbook = await readProceduresWorkbook(Buffer.from(await file.arrayBuffer()), input.month, input.correctReversedDates);
    if (form.get("mode") === "preview") return c.json({ summary: workbook.summary, correctedDates: workbook.correctedDates });
    if (form.get("mode") !== "import") throw new Error("invalidData");
    await importProcedures(shopId, input, workbook.fileHash, workbook.rows);
    return c.json({ count: workbook.rows.length });
  } catch (error) {
    const message = error instanceof Error && procedureErrors.includes(error.message) ? error.message : "importFailed";
    const status = message === "UNAUTHENTICATED" ? 401 : ["EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"].includes(message) ? 403 : message === "conflict" || message === "alreadyImported" ? 409 : 400;
    return c.json({ error: message }, status);
  }
});
