import "server-only";
import { z } from "zod";
import { adminDb as db } from "@/lib/firebase-admin";
import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { attendanceDateSchema, attendanceEntrySchema, attendanceDaySchema, attendanceMonthConfigSchema, attendanceMonthSchema, attendanceRosterSchema, attendanceStaffSchema, dailyClosingSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { getMonthlyRepresentatives, type Shop } from "@/lib/types";
import { monthDates, type AttendanceConfig, type AttendanceDay, type AttendanceMonth } from "@/lib/attendance";
import { createActivity, toFirestoreData } from "@/app/actions/shared";

export const attendanceChangesSchema = z.array(z.object({
  date: attendanceDateSchema,
  entries: z.array(attendanceEntrySchema).max(50).refine(entries => new Set(entries.map(entry => entry.staffId)).size === entries.length, "Duplicate staff entry"),
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict()).max(31).refine(changes => new Set(changes.map(change => change.date)).size === changes.length, "Duplicate date");

export async function loadAttendanceMonth(shopId: string, month: string): Promise<AttendanceMonth> {
  shopIdSchema.parse(shopId);
  attendanceMonthSchema.parse(month);
  await requireShopAccess(shopId);
  const shopRef = db.collection("shops").doc(shopId);
  const [shopSnapshot, configSnapshot, daySnapshot, closingSnapshot] = await Promise.all([
    shopRef.get(), shopRef.collection("attendanceMonths").doc(month).get(),
    shopRef.collection("attendanceDays").where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).limit(31).get(),
    shopRef.collection("dailyClosings").where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).limit(31).get(),
  ]);
  if (!shopSnapshot.exists) throw new Error("notFound");
  const shop = shopSchema.parse({ id: shopId, ...shopSnapshot.data() }) as Shop;
  const config: AttendanceConfig = configSnapshot.exists ? attendanceMonthConfigSchema.parse(configSnapshot.data()) : {
    revision: 0, staff: z.array(attendanceStaffSchema).max(50).parse(getMonthlyRepresentatives(shop, month).map(rep => ({ ...rep, role: "SR" as const }))),
  };
  return { config, days: daySnapshot.docs.map(document => attendanceDaySchema.parse(document.data())),
    lockedDates: closingSnapshot.docs.filter(document => dailyClosingSchema.shape.status.parse(document.data().status) === "finalized").map(document => document.id) };
}

type SaveOptions = {
  shopId: string; month: string; expectedRevision: number;
  changes: z.infer<typeof attendanceChangesSchema>;
  staff?: AttendanceConfig["staff"];
  template?: AttendanceConfig["template"];
  templateBytes?: string;
};

export async function saveAttendance(options: SaveOptions) {
  const shopId = shopIdSchema.parse(options.shopId);
  const month = attendanceMonthSchema.parse(options.month);
  const expectedRevision = z.number().int().nonnegative().parse(options.expectedRevision);
  const changes = attendanceChangesSchema.parse(options.changes);
  if (changes.some(change => !change.date.startsWith(`${month}-`))) throw new Error("invalidData");
  const actor = await requireEditorForShops([shopId]);
  const loaded = await loadAttendanceMonth(shopId, month);
  const staff = attendanceRosterSchema.parse(options.staff ?? loaded.config.staff);
  const staffIds = new Set(staff.map(person => person.id));
  if (changes.some(change => change.entries.some(entry => !staffIds.has(entry.staffId)))) throw new Error("invalidData");
  // Never orphan history by removing an existing member from a monthly roster.
  if (loaded.days.some(day => day.entries.some(entry => !staffIds.has(entry.staffId)))) throw new Error("staffInUse");
  const ref = db.collection("shops").doc(shopId);
  const now = new Date().toISOString();
  const activity = await createActivity({ action: "attendance_saved", summary: `Updated attendance for ${month}.`, shopIds: [shopId], shopNames: [], metadata: { month, days: changes.length } }, actor);
  await db.runTransaction(async transaction => {
    const configSnapshot = await transaction.get(ref.collection("attendanceMonths").doc(month));
    const current = configSnapshot.exists ? attendanceMonthConfigSchema.parse(configSnapshot.data()) : loaded.config;
    if (current.revision !== expectedRevision) throw new Error("conflict");
    const monthClosings = options.staff ? await transaction.get(ref.collection("dailyClosings").where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).limit(31)) : null;
    const snapshots = await Promise.all(changes.map(async change => ({ change,
      day: await transaction.get(ref.collection("attendanceDays").doc(change.date)),
      closing: await transaction.get(ref.collection("dailyClosings").doc(change.date)),
    })));
    // Roster changes on a locked month could change names or roles in historical exports.
    if (options.staff && JSON.stringify(staff) !== JSON.stringify(current.staff) && monthClosings?.docs.some(document => dailyClosingSchema.shape.status.parse(document.data().status) === "finalized")) throw new Error("lockedRoster");
    for (const { change, day, closing } of snapshots) {
      if (closing.exists && dailyClosingSchema.shape.status.parse(closing.data()?.status) === "finalized") throw new Error("locked");
      const existing = day.exists ? attendanceDaySchema.parse(day.data()) : null;
      if ((existing?.updatedAt ?? null) !== change.expectedUpdatedAt) throw new Error("conflict");
      if (!options.templateBytes) {
        for (const entry of change.entries) {
          if (entry.originalText === undefined) continue;
          const original = existing?.entries.find(value => value.staffId === entry.staffId);
          if (!original || entry.originalText !== original.originalText || entry.code !== original.code || entry.note !== original.note) throw new Error("invalidData");
        }
      }
    }
    const config = attendanceMonthConfigSchema.parse({ staff, revision: current.revision + 1, template: options.template ?? current.template });
    transaction.set(ref.collection("attendanceMonths").doc(month), toFirestoreData(config));
    for (const { change } of snapshots) {
      const day: AttendanceDay = attendanceDaySchema.parse({ date: change.date, entries: change.entries, updatedAt: now, updatedBy: actor.id });
      transaction.set(ref.collection("attendanceDays").doc(change.date), day);
    }
    if (options.templateBytes && config.template) {
      const templateRef = ref.collection("attendanceTemplates").doc(config.template.id);
      const chunks = options.templateBytes.match(/.{1,250000}/g) ?? [];
      transaction.set(templateRef, { chunks: chunks.length, createdAt: now });
      chunks.forEach((data, index) => transaction.set(templateRef.collection("chunks").doc(String(index)), { data }));
    }
    transaction.set(activity.reference, activity.data);
  });
  return loadAttendanceMonth(shopId, month);
}

export async function loadAttendanceTemplate(shopId: string, config: AttendanceConfig) {
  await requireShopAccess(shopId);
  if (!config.template) throw new Error("noTemplate");
  const ref = db.collection("shops").doc(shopId).collection("attendanceTemplates").doc(config.template.id);
  const snapshot = await ref.get();
  const metadata = z.object({ chunks: z.number().int().min(1).max(12) }).passthrough().parse(snapshot.data());
  const chunks = await Promise.all(Array.from({ length: metadata.chunks }, (_, index) => ref.collection("chunks").doc(String(index)).get()));
  return Buffer.from(chunks.map(chunk => z.object({ data: z.string().max(250000) }).parse(chunk.data()).data).join(""), "base64");
}

export function attendanceImportChanges(month: string, days: Array<{ date: string; entries: AttendanceDay["entries"] }>, loaded: AttendanceMonth) {
  const dates = new Set(monthDates(month));
  return days.filter(day => dates.has(day.date)).map(day => ({ ...day,
    expectedUpdatedAt: loaded.days.find(existing => existing.date === day.date)?.updatedAt ?? null }));
}

export async function deleteShopAttendance(shopId: string) {
  const id = shopIdSchema.parse(shopId);
  const ref = db.collection("shops").doc(id);
  for (const name of ["attendanceDays", "attendanceMonths", "attendanceTemplates"]) await db.recursiveDelete(ref.collection(name));
}
