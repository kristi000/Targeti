import "server-only";

import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { createActivity, toFirestoreData } from "@/app/actions/shared";
import { aggregateDailyActivity, dailyActivityDaySchema, dailyActivityMonthSchema, dailyActivityRequestSchema, dailyActivitySettingsSchema, saveDailyActivitySettingsSchema, type DailyActivityMonth, type DailyActivitySettings, type SaveDailyActivitySettingsInput } from "@/lib/daily-activity";
import { adminDb as db, documentId } from "@/lib/firebase-admin";
import { shopSchema } from "@/lib/persistence-schemas";
import { getProcedureSummary } from "@/lib/server/procedures";

export async function loadDailyActivitySettings(shopId: string, month: string): Promise<DailyActivitySettings | null> {
  const request = dailyActivityRequestSchema.parse({ shopId, month });
  await requireShopAccess(request.shopId);
  const [shopSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("shops").where(documentId(), "==", request.shopId).limit(1).select("name").get(),
    db.collection("shops").doc(request.shopId).collection("dailyActivityMonths").doc(request.month).get(),
  ]);
  if (shopSnapshot.empty) throw new Error("SHOP_NOT_FOUND");
  shopSchema.pick({ name: true }).strip().parse(shopSnapshot.docs[0].data());
  return settingsSnapshot.exists ? dailyActivitySettingsSchema.parse(settingsSnapshot.data()) as DailyActivitySettings : null;
}

export async function loadDailyActivityMonth(shopId: string, month: string): Promise<DailyActivityMonth> {
  const request = dailyActivityRequestSchema.parse({ shopId, month });
  await requireShopAccess(request.shopId);
  const shopRef = db.collection("shops").doc(request.shopId);
  const [shopSnapshot, settingsSnapshot, closingSnapshot, procedures] = await Promise.all([
    shopRef.get(),
    shopRef.collection("dailyActivityMonths").doc(request.month).get(),
    shopRef.collection("dailyClosings")
      .where(documentId(), ">=", `${request.month}-01`)
      .where(documentId(), "<=", `${request.month}-31`)
      .orderBy(documentId()).limit(31)
      .select("date", "status", "activities", "updatedAt").get(),
    getProcedureSummary(request.shopId, request.month),
  ]);
  if (!shopSnapshot.exists) throw new Error("SHOP_NOT_FOUND");
  shopSchema.pick({ name: true }).strip().parse(shopSnapshot.data());
  const settings = settingsSnapshot.exists ? dailyActivitySettingsSchema.parse(settingsSnapshot.data()) as DailyActivitySettings : null;
  const days = closingSnapshot.docs.map(document => {
    const closing = dailyActivityDaySchema.strip().parse(document.data());
    if (closing.date !== document.id || !closing.date.startsWith(`${request.month}-`)) {
      throw new Error("INVALID_DAILY_ACTIVITY_DATE");
    }
    return closing;
  });
  return dailyActivityMonthSchema.parse({ settings, days, actuals: aggregateDailyActivity(days), procedures }) as DailyActivityMonth;
}

export async function persistDailyActivitySettings(input: SaveDailyActivitySettingsInput): Promise<DailyActivitySettings> {
  const value = saveDailyActivitySettingsSchema.parse(input);
  const actor = await requireEditorForShops([value.shopId]);
  const shopRef = db.collection("shops").doc(value.shopId);
  const settingsRef = shopRef.collection("dailyActivityMonths").doc(value.month);
  return db.runTransaction(async transaction => {
    const [shopSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(shopRef), transaction.get(settingsRef),
    ]);
    if (!shopSnapshot.exists) throw new Error("SHOP_NOT_FOUND");
    const shop = shopSchema.pick({ name: true }).strip().parse(shopSnapshot.data());
    const current = settingsSnapshot.exists ? dailyActivitySettingsSchema.parse(settingsSnapshot.data()) : null;
    if ((current?.revision ?? 0) !== value.expectedRevision) throw new Error("DAILY_ACTIVITY_CONFLICT");
    const settings = dailyActivitySettingsSchema.parse({
      revision: value.expectedRevision + 1,
      targets: value.targets,
      metricOrder: value.metricOrder,
      metricSettings: value.metricSettings,
      weightProfileId: value.weightProfileId,
      updatedAt: new Date().toISOString(),
    });
    const activity = await createActivity({
      action: "daily_activity_settings_saved",
      summary: `Updated Daily Activity settings for ${shop.name} in ${value.month}.`,
      shopIds: [value.shopId], shopNames: [shop.name],
      metadata: { month: value.month, revision: settings.revision, metrics: settings.metricOrder.length },
    }, actor);
    transaction.set(settingsRef, toFirestoreData(settings));
    transaction.set(activity.reference, activity.data);
    return settings as DailyActivitySettings;
  });
}
