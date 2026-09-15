"use server";

import { z } from "zod";
import { collection, getDocs, writeBatch, type DocumentReference } from "@/lib/firebase-admin";
import { requireAdmin, requireEditorForShops } from "@/lib/access";
import { getMetricWeight } from "@/lib/data";
import { refreshDashboardSummaries } from "@/app/dashboard-actions";
import { performanceDataSchema, metricKeySchema, monthSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { getQuarterKey, type MetricSettings, type PerformanceData, type PerformanceMetric, type Shop, type Target } from "@/lib/types";
import { mutationError, omitId, parseFirestoreDocument, recordActivity, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";

const bulkMetricWeightsSchema = z.object({
  month: monthSchema,
  shopIds: z.array(shopIdSchema).min(1).max(500),
  weights: z.record(metricKeySchema, z.number().finite().min(0).max(1)),
}).superRefine((value, context) => {
  const weights = Object.values(value.weights);
  if (!weights.length || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 0.00001) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Metric weights must total exactly 100%." });
  }
});

export async function handleApplyMetricWeightsToShops(month: string, weights: Record<string, number>, shopIds: string[]) {
  try {
    const input = bulkMetricWeightsSchema.parse({ month, weights, shopIds }) as { month: string; shopIds: string[]; weights: Record<PerformanceMetric, number> };
    await requireEditorForShops(input.shopIds);
    const quarterKey = getQuarterKey(`${input.month}-01`);
    const snapshot = await getDocs(collection(db, "shops"));
    const selectedShopIds = new Set(input.shopIds);
    const selectedDocuments = snapshot.docs.filter(document => selectedShopIds.has(document.id));
    if (selectedDocuments.length !== selectedShopIds.size) throw new Error("One or more selected shops no longer exist.");
    const batch = writeBatch(db);

    selectedDocuments.forEach(document => {
      const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
      if (!shop) return;
      const monthData = shop.monthlyData?.[input.month];
      const quarter = shop.quarterSettings?.[quarterKey];
      const currentSettings = monthData?.metricSettings ?? quarter?.metricSettings ?? shop.metricSettings ?? {};
      const currentOrder = monthData?.metricOrder ?? quarter?.metricOrder ?? shop.metricOrder ?? [];
      const weightMetrics = Object.keys(input.weights) as PerformanceMetric[];
      const metricOrder: PerformanceMetric[] = [
        ...currentOrder.filter(metric => metric in input.weights),
        ...weightMetrics.filter(metric => !currentOrder.includes(metric)),
      ];
      const metricSettings = Object.fromEntries(metricOrder.map(metric => [metric, {
        ...currentSettings[metric],
        weight: input.weights[metric],
      }])) as MetricSettings;
      const nextShop: Shop = {
        ...shop,
        quarterSettings: {
          ...shop.quarterSettings,
          [quarterKey]: { metricSettings, metricOrder },
        },
        ...(monthData && {
          monthlyData: {
            ...shop.monthlyData,
            [input.month]: { ...monthData, metricSettings, metricOrder },
          },
        }),
      };
      const shopData = omitId(shopSchema.parse(nextShop) as Shop);
      batch.set(document.ref, toFirestoreData(shopData));
    });

    await batch.commit();
    await refreshDashboardSummaries({ shopIds: selectedDocuments.map(document => document.id), months: [input.month] });
    return { success: true as const, count: selectedDocuments.length };
  } catch (error) {
    return { success: false as const, error: mutationError("apply metric weights to the selected shops", error) };
  }
}

function removeMetricFromShop(shop: Shop, metric: string): Shop {
  return {
    ...shop,
    disabledMetrics: Array.from(new Set([...(shop.disabledMetrics ?? []), metric as PerformanceMetric])),
  } as Shop;
}

function restoreTargetMetric(targets: Target | undefined, metric: PerformanceMetric) {
  if (!targets || metric in targets) return targets;
  return { ...targets, [metric]: 0 } as Target;
}

function restoreMetricOrder(metricOrder: PerformanceMetric[] | undefined, metric: PerformanceMetric) {
  return metricOrder?.includes(metric) ? metricOrder : [...(metricOrder ?? []), metric];
}

function restoreMetricToShop(shop: Shop, metric: PerformanceMetric): Shop {
  const savedSetting = shop.metricSettings?.[metric]
    ?? Object.values(shop.monthlyData ?? {}).find(data => data.metricSettings?.[metric])?.metricSettings?.[metric]
    ?? Object.values(shop.quarterSettings ?? {}).find(settings => settings.metricSettings[metric])?.metricSettings[metric]
    ?? { weight: getMetricWeight(metric) };

  return {
    ...shop,
    disabledMetrics: shop.disabledMetrics?.filter(item => item !== metric),
    monthlyTargets: restoreTargetMetric(shop.monthlyTargets, metric),
    metricSettings: { ...shop.metricSettings, [metric]: savedSetting },
    metricOrder: restoreMetricOrder(shop.metricOrder, metric),
    monthlyData: shop.monthlyData && Object.fromEntries(Object.entries(shop.monthlyData).map(([month, data]) => [month, {
      ...data,
      targets: restoreTargetMetric(data.targets, metric),
      representativeTargets: Object.fromEntries(Object.entries(data.representativeTargets).map(([repId, targets]) => [repId, restoreTargetMetric(targets, metric)])),
      metricSettings: { ...data.metricSettings, [metric]: data.metricSettings?.[metric] ?? savedSetting },
      metricOrder: restoreMetricOrder(data.metricOrder, metric),
    }])),
    quarterSettings: shop.quarterSettings && Object.fromEntries(Object.entries(shop.quarterSettings).map(([quarter, settings]) => [quarter, {
      metricSettings: { ...settings.metricSettings, [metric]: settings.metricSettings[metric] ?? savedSetting },
      metricOrder: restoreMetricOrder(settings.metricOrder, metric),
    }])),
  } as Shop;
}

function restoreMetricToPerformance(data: PerformanceData, metric: PerformanceMetric): PerformanceData {
  return {
    ...data,
    reps: data.reps.map(rep => ({ ...rep, [metric]: rep[metric] ?? 0 })),
    shopActuals: data.shopActuals ? { ...data.shopActuals, [metric]: data.shopActuals[metric] ?? 0 } : undefined,
    targets: restoreTargetMetric(data.targets, metric),
  };
}

const selectedMetricRemovalSchema = z.object({ metric: metricKeySchema, shopIds: z.array(shopIdSchema).min(1).max(500) });

export async function handleRemoveMetricFromShops(metric: string, shopIds: string[]) {
  try {
    await requireAdmin();
    const input = selectedMetricRemovalSchema.parse({ metric, shopIds });
    const validMetric = input.metric;
    const selectedShopIds = new Set(input.shopIds);
    const shops = await getDocs(collection(db, "shops"));
    const selectedDocuments = shops.docs.filter(document => selectedShopIds.has(document.id));
    if (selectedDocuments.length !== selectedShopIds.size) throw new Error("One or more selected shops no longer exist.");
    const writes: Array<{ reference: DocumentReference; data: Record<string, unknown> }> = selectedDocuments.flatMap(document => {
      const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
      if (!shop) return [];
      const nextShop = shopSchema.parse(removeMetricFromShop(shop, validMetric)) as Shop;
      const shopData = omitId(nextShop);
      return [{ reference: document.ref, data: toFirestoreData(shopData) }];
    });

    for (let start = 0; start < writes.length; start += 450) {
      const batch = writeBatch(db);
      writes.slice(start, start + 450).forEach(write => batch.set(write.reference, write.data));
      await batch.commit();
    }
    await refreshDashboardSummaries({ shopIds: selectedDocuments.map(document => document.id) });
    await recordActivity({ action: "metric_deleted", summary: `Removed metric ${validMetric} from ${selectedDocuments.length} shop(s).`, shopIds: selectedDocuments.map(item => item.id), shopNames: selectedDocuments.map(item => String(item.data().name ?? item.id)), metadata: { metric: validMetric, shopCount: selectedDocuments.length } });
    return { success: true as const, shops: selectedDocuments.length };
  } catch (error) {
    return { success: false as const, error: mutationError("remove the metric from the selected shops", error) };
  }
}

export async function handleRestoreMetricToShops(metric: string, shopIds: string[]) {
  try {
    const input = selectedMetricRemovalSchema.parse({ metric, shopIds });
    await requireEditorForShops(input.shopIds);
    const validMetric = input.metric as PerformanceMetric;
    const selectedShopIds = new Set(input.shopIds);
    const shops = await getDocs(collection(db, "shops"));
    const selectedDocuments = shops.docs.filter(document => selectedShopIds.has(document.id));
    if (selectedDocuments.length !== selectedShopIds.size) throw new Error("One or more selected shops no longer exist.");
    const writes: Array<{ reference: DocumentReference; data: Record<string, unknown> }> = [];

    await Promise.all(selectedDocuments.map(async document => {
      const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
      if (!shop || !shop.disabledMetrics?.includes(validMetric)) return;
      const nextShop = shopSchema.parse(restoreMetricToShop(shop, validMetric)) as Shop;
      const shopData = omitId(nextShop);
      writes.push({ reference: document.ref, data: toFirestoreData(shopData) });

      const performance = await getDocs(collection(db, "shops", document.id, "performance"));
      performance.docs.forEach(performanceDocument => {
        const parsed = performanceDataSchema.safeParse({ id: performanceDocument.id, ...performanceDocument.data() });
        if (!parsed.success) return;
        const nextPerformance = performanceDataSchema.parse(restoreMetricToPerformance(parsed.data as unknown as PerformanceData, validMetric)) as unknown as PerformanceData;
        const performanceData = omitId(nextPerformance);
        writes.push({ reference: performanceDocument.ref, data: toFirestoreData(performanceData) });
      });
    }));

    for (let start = 0; start < writes.length; start += 450) {
      const batch = writeBatch(db);
      writes.slice(start, start + 450).forEach(write => batch.set(write.reference, write.data));
      await batch.commit();
    }
    await refreshDashboardSummaries({ shopIds: selectedDocuments.map(document => document.id) });
    return { success: true as const, shops: selectedDocuments.length };
  } catch (error) {
    return { success: false as const, error: mutationError("restore the metric for the selected shops", error) };
  }
}
