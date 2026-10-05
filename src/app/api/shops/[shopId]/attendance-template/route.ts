import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { adminDb as db } from "@/lib/firebase-admin";
import { attendanceMonthSchema, attendanceRosterSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { exportAttendanceWorkbook, inspectAttendanceWorkbook, MAX_ATTENDANCE_FILE_BYTES, normalizeAttendanceName, workbookAttendanceDays } from "@/lib/attendance-workbook";
import { attendanceImportChanges, loadAttendanceMonth, loadAttendanceTemplate, saveAttendance } from "@/lib/server/attendance";

export const runtime = "nodejs";
type Context = { params: Promise<{ shopId: string }> };
function hasValidRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const first = (value: string | null) => value?.split(",", 1)[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  const protocol = first(request.headers.get("x-forwarded-proto")) ?? request.nextUrl.protocol.slice(0, -1);
  if (!host) return origin === request.nextUrl.origin;
  try { return new URL(origin).origin === new URL(`${protocol}://${host}`).origin; }
  catch { return false; }
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "requestFailed";
  const allowed = ["useMatchingSheet", "monthHasData", "fileTooLarge", "invalidTemplate", "conflict", "locked", "lockedRoster", "staffInUse", "noTemplate", "templateCapacity", "wrongShop", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
  return NextResponse.json({ error: allowed.includes(message) ? message : "requestFailed" }, { status: message === "UNAUTHENTICATED" ? 401 : message === "EDITOR_REQUIRED" || message === "SHOP_ACCESS_REQUIRED" ? 403 : 400 });
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const shopId = shopIdSchema.parse((await context.params).shopId);
    await requireEditorForShops([shopId]);
    if (!hasValidRequestOrigin(request)) return NextResponse.json({ error: "requestFailed" }, { status: 403 });
    if (Number(request.headers.get("content-length")) > MAX_ATTENDANCE_FILE_BYTES + 100_000) throw new Error("fileTooLarge");
    const form = await request.formData();
    const mode = z.enum(["preview", "import"]).parse(form.get("mode"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > MAX_ATTENDANCE_FILE_BYTES) throw new Error("invalidTemplate");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sheets = inspectAttendanceWorkbook(bytes);
    const shopSnapshot = await db.collection("shops").doc(shopId).get();
    const shop = shopSchema.parse({ id: shopId, ...shopSnapshot.data() });
    if (sheets.some(sheet => normalizeAttendanceName(sheet.shopName) !== normalizeAttendanceName(shop.name))) throw new Error("wrongShop");
    if (mode === "preview") return NextResponse.json({ sheets });
    const input = z.object({ month: attendanceMonthSchema, sheet: z.string().min(1).max(31), expectedRevision: z.number().int().nonnegative(),
      staff: attendanceRosterSchema,
      mapping: z.array(z.object({ column: z.number().int().min(3).max(26), staffId: z.string().min(1).max(150) }).strict()).min(1).max(24),
      expectedDays: z.record(z.string(), z.string().datetime().nullable()).refine(days => Object.keys(days).length <= 31),
    }).strict().parse(JSON.parse(String(form.get("input"))));
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
    return NextResponse.json({ data });
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const shopId = shopIdSchema.parse((await context.params).shopId);
    await requireShopAccess(shopId);
    const month = attendanceMonthSchema.parse(request.nextUrl.searchParams.get("month"));
    const loaded = await loadAttendanceMonth(shopId, month);
    const bytes = await loadAttendanceTemplate(shopId, loaded.config);
    const exported = exportAttendanceWorkbook(bytes, loaded);
    return new NextResponse(Buffer.from(exported), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attendance-${month}.xlsx"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return failure(error); }
}
