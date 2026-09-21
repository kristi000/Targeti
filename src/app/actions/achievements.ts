"use server";

import { z } from "zod";
import { collection, deleteField, doc, documentId, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from "@/lib/firebase-admin";
import { requireEditorForShops } from "@/lib/access";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { performanceDataSchema, metricKeySchema, monthSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { type PerformanceData, type PerformanceMetric, type RepPerformanceData } from "@/lib/types";
import { mutationError, omitId, recordActivity, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

const achievementEditSchema = z.object({
  shopId: shopIdSchema,
  month: monthSchema,
  reps: z.array(z.object({
    repId: shopIdSchema,
    repName: z.string().trim().min(1).max(120).optional(),
  }).catchall(z.number().finite().nonnegative())).min(1, "At least one representative is required.").max(500),
}).strict();

function sumRepresentativeAchievements(reps: RepPerformanceData[]): Partial<Record<PerformanceMetric, number>> {
  return reps.reduce((totals, representative) => {
    Object.entries(representative).forEach(([key, value]) => {
      if (key === "repId" || key === "repName" || typeof value !== "number") return;
      const metric = metricKeySchema.parse(key) as PerformanceMetric;
      totals[metric] = (totals[metric] ?? 0) + value;
    });
    return totals;
  }, {} as Partial<Record<PerformanceMetric, number>>);
}

export async function handleSaveAchievementOverrides(shopId: string, month: string, reps: RepPerformanceData[]) {
  try {
    await requireEditorForShops([shopId]);
    const input = achievementEditSchema.parse({ shopId, month, reps }) as unknown as {
      shopId: string;
      month: string;
      reps: RepPerformanceData[];
    };
    const performanceSnapshot = await getDocs(collection(db, "shops", input.shopId, "performance"));
    const reports = performanceSnapshot.docs.flatMap(document => {
      const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
      return parsed.success && parsed.data.date.startsWith(input.month)
        ? [{ reference: document.ref, data: parsed.data as unknown as PerformanceData }]
        : [];
    });
    const importedReport = reports
      .filter(report => report.data.importId)
      .sort((left, right) =>
        (right.data.importedAt ?? right.data.date).localeCompare(left.data.importedAt ?? left.data.date),
      )[0];
    const now = new Date().toISOString();

    if (importedReport) {
      const original = importedReport.data.achievementOverride;
      const nextReport: PerformanceData = {
        ...importedReport.data,
        reps: input.reps,
        shopActuals: sumRepresentativeAchievements(input.reps),
        achievementOverride: {
          updatedAt: now,
          originalReps: original?.originalReps ?? importedReport.data.reps,
          originalShopActuals: original?.originalShopActuals ?? importedReport.data.shopActuals,
        },
      };
      const documentData = omitId(performanceDataSchema.parse(nextReport) as unknown as PerformanceData);
      await setDoc(importedReport.reference, toFirestoreData(documentData));
    } else {
      const manualReport: PerformanceData = {
        id: `${input.month}-01`,
        date: `${input.month}-01`,
        reps: input.reps,
        shopActuals: sumRepresentativeAchievements(input.reps),
      };
      const documentData = omitId(performanceDataSchema.parse(manualReport) as unknown as PerformanceData);
      await setDoc(doc(db, "shops", input.shopId, "performance", manualReport.id!), toFirestoreData(documentData));
    }

    await refreshDashboardSummaries({ shopIds: [input.shopId], months: [input.month], performanceChanged: true });

    const shopDocument = (await getDocs(query(collection(db, "shops"), where(documentId(), "==", input.shopId), limit(1)))).docs[0];
    const shopName = String(shopDocument?.data().name ?? input.shopId);
    await recordActivity({
      action: "achievements_changed",
      summary: `Manually changed achievements for ${shopName} in ${input.month}.`,
      shopIds: [input.shopId],
      shopNames: [shopName],
      metadata: { month: input.month, importedOverride: Boolean(importedReport) },
    });
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("save achievement changes", error) };
  }
}

export async function handleRevertAchievementOverrides(shopId: string, performanceId: string) {
  try {
    await requireEditorForShops([shopId]);
    const validShopId = shopIdSchema.parse(shopId);
    const validPerformanceId = shopIdSchema.parse(performanceId);
    const reference = doc(db, "shops", validShopId, "performance", validPerformanceId);
    const snapshot = await getDoc(reference);
    const parsed = snapshot.exists
      ? performanceDataSchema.safeParse({ id: snapshot.id, ...snapshot.data() })
      : null;
    if (!parsed?.success || !parsed.data.achievementOverride) throw new Error("OVERRIDE_NOT_FOUND");
    const report = parsed.data as unknown as PerformanceData;
    const original = report.achievementOverride!;
    await updateDoc(reference, {
      reps: toFirestoreData(original.originalReps),
      shopActuals: original.originalShopActuals
        ? toFirestoreData(original.originalShopActuals)
        : deleteField(),
      achievementOverride: deleteField(),
    });
    await refreshDashboardSummaries({ shopIds: [validShopId], months: [report.date.slice(0, 7)], performanceChanged: true });

    const shopDocument = (await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShopId), limit(1)))).docs[0];
    const shopName = String(shopDocument?.data().name ?? validShopId);
    await recordActivity({
      action: "achievements_reverted",
      summary: `Reverted achievement changes for ${shopName} in ${report.date.slice(0, 7)}.`,
      shopIds: [validShopId],
      shopNames: [shopName],
      metadata: { month: report.date.slice(0, 7), performanceId: validPerformanceId },
    });
    return { success: true as const };
  } catch (error) {
    if (error instanceof Error && error.message === "OVERRIDE_NOT_FOUND") {
      return { success: false as const, error: "These achievements are already using the imported data." };
    }
    return { success: false as const, error: mutationError("revert achievement changes", error) };
  }
}
