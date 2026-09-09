"use server";

import { format, getDaysInMonth, parseISO, subMonths } from "date-fns";
import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";

import { getCurrentActor, requireEditor } from "@/lib/access";
import { adminDb } from "@/lib/firebase-admin";
import { monthSchema, performanceDataSchema, shopIdSchema, shopSchema, supervisorSchema } from "@/lib/persistence-schemas";
import { calculateTotalAchievement } from "@/lib/utils";
import { getOverviewPerformanceData, getPerformanceShopActuals, getShopMetrics, type PerformanceData, type Shop, type Supervisor } from "@/lib/types";
import type { DashboardCursor, DashboardRow, DashboardSortKey, DashboardSummary, DashboardSupervisorRow } from "@/lib/dashboard-types";

export type { DashboardCursor, DashboardRow, DashboardSortKey, DashboardSummary, DashboardSupervisorRow } from "@/lib/dashboard-types";

type ShopSummary = {
  schemaVersion: 2;
  shopId: string;
  shopName: string;
  normalizedShopName: string;
  supervisorId: string | null;
  supervisorName: string | null;
  searchPrefixes: string[];
  achievement: number;
  achievementAsc: number;
  achievementDesc: number;
  forecast: number;
  forecastAsc: number;
  forecastDesc: number;
  revenue: number;
  revenueAsc: number;
  revenueDesc: number;
  isFinal: boolean;
  hasData: boolean;
  updatedAt: string;
};

type MonthMeta = {
  schemaVersion: 2;
  summary: Omit<DashboardSummary, "previousAverage" | "previousRevenue">;
  supervisorRows: DashboardSupervisorRow[];
  updatedAt: string;
};

const dashboardPageSchema = z.object({
  month: monthSchema,
  search: z.string().trim().max(120).default(""),
  pageSize: z.number().int().min(5).max(50),
  cursor: z.object({
    hasData: z.boolean(),
    value: z.union([z.string().max(120), z.number().finite()]),
    name: z.string().min(1).max(120),
    id: shopIdSchema,
  }).nullable().optional(),
  sortBy: z.enum(["shop", "achievement", "forecast", "revenue"]).default("shop"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

const refreshSchema = z.object({
  shopIds: z.array(shopIdSchema).min(1).max(500),
  months: z.array(monthSchema).max(120).optional(),
}).strict();

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function searchPrefixes(...values: Array<string | null>) {
  const prefixes = new Set<string>();
  values.filter((value): value is string => Boolean(value)).forEach(value => {
    const normalized = normalizeText(value);
    const candidates = [normalized, ...normalized.split(" ")];
    candidates.forEach(candidate => {
      for (let length = 1; length <= candidate.length; length += 1) prefixes.add(candidate.slice(0, length));
    });
  });
  return [...prefixes];
}

function performanceSummary(shop: Shop, entries: PerformanceData[]) {
  const active = getOverviewPerformanceData(entries);
  const report = active.at(-1);
  const targets = report?.targets ?? shop.monthlyData?.[report?.date.slice(0, 7) ?? ""]?.targets ?? shop.monthlyTargets;
  if (!report || !targets) return { achievement: 0, revenue: 0, forecast: 0, isFinal: false, hasData: false };
  const monthData = shop.monthlyData?.[report.date.slice(0, 7)];
  const settings = monthData?.metricSettings ?? shop.metricSettings;
  const metrics = getShopMetrics({ ...shop, metricSettings: settings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, targets);
  const actuals = getPerformanceShopActuals(active, metrics);
  const achievement = calculateTotalAchievement(actuals, targets, settings);
  const isFinal = report.reportType === "completedMonth";
  const reportedDate = parseISO(report.asOfDate ?? report.date);
  const forecast = isFinal ? achievement : achievement / Math.max(reportedDate.getDate(), 1) * getDaysInMonth(reportedDate);
  return { achievement, revenue: report.revenue ?? monthData?.collection ?? 0, forecast, isFinal, hasData: true };
}

function parseShop(document: FirebaseFirestore.DocumentSnapshot) {
  const parsed = shopSchema.safeParse({ id: document.id, ...document.data() });
  return parsed.success ? parsed.data as unknown as Shop : null;
}

function parsePerformance(document: FirebaseFirestore.QueryDocumentSnapshot) {
  const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
  return parsed.success ? parsed.data as unknown as PerformanceData : null;
}

async function loadSupervisors() {
  const snapshot = await adminDb.collection("supervisors").get();
  return snapshot.docs.flatMap(document => {
    const parsed = supervisorSchema.safeParse({ id: document.id, ...document.data() });
    return parsed.success ? [parsed.data as Supervisor] : [];
  });
}

function createShopSummary(shop: Shop, entries: PerformanceData[], supervisors: Map<string, Supervisor>): ShopSummary {
  const result = performanceSummary(shop, entries);
  const supervisor = shop.supervisorId ? supervisors.get(shop.supervisorId) : undefined;
  return {
    schemaVersion: 2,
    shopId: shop.id,
    shopName: shop.name,
    normalizedShopName: normalizeText(shop.name),
    supervisorId: supervisor?.id ?? null,
    supervisorName: supervisor?.name ?? null,
    searchPrefixes: searchPrefixes(shop.name, supervisor?.name ?? null),
    achievement: result.achievement,
    achievementAsc: result.hasData ? result.achievement : Number.MAX_SAFE_INTEGER,
    achievementDesc: result.hasData ? result.achievement : -1,
    forecast: result.forecast,
    forecastAsc: result.hasData ? result.forecast : Number.MAX_SAFE_INTEGER,
    forecastDesc: result.hasData ? result.forecast : -1,
    revenue: result.revenue,
    revenueAsc: result.hasData ? result.revenue : Number.MAX_SAFE_INTEGER,
    revenueDesc: result.hasData ? result.revenue : -1,
    isFinal: result.isFinal,
    hasData: result.hasData,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeDocuments(documents: FirebaseFirestore.QueryDocumentSnapshot[]): MonthMeta {
  const values = documents.map(document => document.data() as ShopSummary);
  const reporting = values.filter(value => value.hasData);
  const supervisors = new Map<string, { name: string; values: ShopSummary[] }>();
  values.forEach(value => {
    if (!value.supervisorId || !value.supervisorName) return;
    const current = supervisors.get(value.supervisorId) ?? { name: value.supervisorName, values: [] };
    current.values.push(value);
    supervisors.set(value.supervisorId, current);
  });
  const supervisorRows = [...supervisors].map(([id, group]) => {
    const active = group.values.filter(value => value.hasData);
    return {
      id,
      name: group.name,
      shopCount: group.values.length,
      activeShops: active.length,
      shopsAtTarget: active.filter(value => value.achievement >= 100).length,
      averageAchievement: active.length ? active.reduce((sum, value) => sum + value.achievement, 0) / active.length : 0,
      forecastAchievement: active.length ? active.reduce((sum, value) => sum + value.forecast, 0) / active.length : null,
      revenue: active.reduce((sum, value) => sum + value.revenue, 0),
    } satisfies DashboardSupervisorRow;
  }).sort((left, right) => right.averageAchievement - left.averageAchievement || left.name.localeCompare(right.name));
  return {
    schemaVersion: 2,
    summary: {
      average: reporting.length ? reporting.reduce((sum, value) => sum + value.achievement, 0) / reporting.length : 0,
      forecast: reporting.length ? reporting.reduce((sum, value) => sum + value.forecast, 0) / reporting.length : null,
      revenue: values.reduce((sum, value) => sum + value.revenue, 0),
      allFinal: reporting.length > 0 && reporting.every(value => value.isFinal),
      activeShops: values.length,
      shopsAtTarget: reporting.filter(value => value.achievement >= 100).length,
    },
    supervisorRows,
    updatedAt: new Date().toISOString(),
  };
}

async function writeMonthMeta(month: string) {
  const shops = await adminDb.collection("dashboardSummaries").doc(month).collection("shops").get();
  await adminDb.collection("dashboardSummaries").doc(month).set(summarizeDocuments(shops.docs));
}

async function rebuildMonth(month: string) {
  const summaryShops = adminDb.collection("dashboardSummaries").doc(month).collection("shops");
  const [shopsSnapshot, performanceSnapshot, supervisors, existingSummaries] = await Promise.all([
    adminDb.collection("shops").get(),
    adminDb.collectionGroup("performance").where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).orderBy("date", "asc").get(),
    loadSupervisors(),
    summaryShops.get(),
  ]);
  const performanceByShop = new Map<string, PerformanceData[]>();
  performanceSnapshot.docs.forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    const entry = parsePerformance(document);
    if (!shopId || !entry) return;
    const entries = performanceByShop.get(shopId) ?? [];
    entries.push(entry);
    performanceByShop.set(shopId, entries);
  });
  const supervisorMap = new Map(supervisors.map(supervisor => [supervisor.id, supervisor]));
  const values = shopsSnapshot.docs.flatMap(document => {
    const shop = parseShop(document);
    return shop ? [createShopSummary(shop, performanceByShop.get(shop.id) ?? [], supervisorMap)] : [];
  });
  const shopIds = new Set(values.map(value => value.shopId));
  const obsoleteReferences = existingSummaries.docs.filter(document => !shopIds.has(document.id)).map(document => document.ref);
  for (let start = 0; start < obsoleteReferences.length; start += 450) {
    const batch = adminDb.batch();
    obsoleteReferences.slice(start, start + 450).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
  for (let start = 0; start < values.length; start += 450) {
    const batch = adminDb.batch();
    values.slice(start, start + 450).forEach(value => batch.set(adminDb.collection("dashboardSummaries").doc(month).collection("shops").doc(value.shopId), value));
    await batch.commit();
  }
  await writeMonthMeta(month);
}

async function ensureMonth(month: string) {
  const reference = adminDb.collection("dashboardSummaries").doc(month);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.schemaVersion !== 2) await rebuildMonth(month);
}

export async function fetchPerformanceDataForMonth(month: string): Promise<Record<string, PerformanceData[]>> {
  await getCurrentActor();
  const validMonth = monthSchema.parse(month);
  const snapshot = await adminDb.collectionGroup("performance")
    .where("date", ">=", `${validMonth}-01`)
    .where("date", "<=", `${validMonth}-31`)
    .orderBy("date", "asc")
    .get();
  const performanceData: Record<string, PerformanceData[]> = {};
  snapshot.docs.forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    const entry = parsePerformance(document);
    if (!shopId || !entry) return;
    (performanceData[shopId] ??= []).push(entry);
  });
  return performanceData;
}

export async function refreshDashboardSummaries(input: { shopIds: string[]; months?: string[] }) {
  await requireEditor();
  const value = refreshSchema.parse(input);
  const supervisors = new Map((await loadSupervisors()).map(supervisor => [supervisor.id, supervisor]));
  const touchedMonths = new Set(value.months ?? []);
  if (!value.months) {
    const existingMonths = await adminDb.collection("dashboardSummaries").listDocuments();
    existingMonths.forEach(document => touchedMonths.add(document.id));
  }
  const shops = await Promise.all(value.shopIds.map(shopId => adminDb.collection("shops").doc(shopId).get()));
  const performanceByShop = await Promise.all(shops.map(shopDocument => shopDocument.exists ? shopDocument.ref.collection("performance").get() : null));
  if (!value.months) {
    shops.forEach((shopDocument, index) => {
      performanceByShop[index]?.docs.forEach(document => {
        const entry = parsePerformance(document);
        if (entry) touchedMonths.add(entry.date.slice(0, 7));
      });
      Object.keys((shopDocument.exists ? parseShop(shopDocument) : null)?.monthlyData ?? {}).forEach(month => touchedMonths.add(month));
    });
  }
  await Promise.all([...touchedMonths].map(ensureMonth));

  for (const [shopIndex, shopDocument] of shops.entries()) {
    const shop = shopDocument.exists ? parseShop(shopDocument) : null;
    const performance = performanceByShop[shopIndex];
    for (const month of touchedMonths) {
      const reference = adminDb.collection("dashboardSummaries").doc(month).collection("shops").doc(shopDocument.id);
      if (!shop) {
        await reference.delete();
        continue;
      }
      const entries = performance?.docs.flatMap(document => {
        const entry = parsePerformance(document);
        return entry?.date.startsWith(month) ? [entry] : [];
      }) ?? [];
      await reference.set(createShopSummary(shop, entries, supervisors));
    }
  }
  await Promise.all([...touchedMonths].map(writeMonthMeta));
}

function summaryFromDocuments(current: FirebaseFirestore.QueryDocumentSnapshot[], previous: FirebaseFirestore.DocumentSnapshot[]): DashboardSummary {
  const currentMeta = summarizeDocuments(current).summary;
  const previousValues = previous.filter(document => document.exists && Boolean(document.data()?.hasData)).map(document => document.data() as ShopSummary);
  return {
    ...currentMeta,
    previousAverage: previousValues.length ? previousValues.reduce((sum, value) => sum + value.achievement, 0) / previousValues.length : null,
    previousRevenue: previousValues.length ? previousValues.reduce((sum, value) => sum + value.revenue, 0) : null,
  };
}

export async function fetchDashboardPage(input: { month: string; search?: string; pageSize: number; cursor?: DashboardCursor | null; sortBy?: DashboardSortKey; sortDirection?: "asc" | "desc" }) {
  await getCurrentActor();
  const value = dashboardPageSchema.parse(input);
  const previousMonth = format(subMonths(parseISO(`${value.month}-01`), 1), "yyyy-MM");
  await Promise.all([ensureMonth(value.month), ensureMonth(previousMonth)]);

  const monthReference = adminDb.collection("dashboardSummaries").doc(value.month);
  let baseQuery: FirebaseFirestore.Query = monthReference.collection("shops");
  const normalizedSearch = normalizeText(value.search);
  if (normalizedSearch) baseQuery = baseQuery.where("searchPrefixes", "array-contains", normalizedSearch);

  const direction = value.sortDirection;
  let pageDocuments: FirebaseFirestore.QueryDocumentSnapshot[];
  let hasMore: boolean;
  let total: number;
  if (normalizedSearch) {
    const matching = await baseQuery.get();
    const directionMultiplier = direction === "asc" ? 1 : -1;
    const getSortValue = (document: FirebaseFirestore.QueryDocumentSnapshot): string | number => {
      const summary = document.data() as ShopSummary;
      if (value.sortBy === "shop") return summary.normalizedShopName;
      if (!summary.hasData) return direction === "asc" ? Number.MAX_SAFE_INTEGER : -1;
      return value.sortBy === "achievement" ? summary.achievement : value.sortBy === "forecast" ? summary.forecast : summary.revenue;
    };
    const sorted = [...matching.docs].sort((left, right) => {
      const leftValue = getSortValue(left);
      const rightValue = getSortValue(right);
      const comparison = typeof leftValue === "string" && typeof rightValue === "string"
        ? leftValue.localeCompare(rightValue)
        : Number(leftValue) - Number(rightValue);
      if (comparison) return comparison * directionMultiplier;
      const nameComparison = String(left.data().normalizedShopName).localeCompare(String(right.data().normalizedShopName));
      return nameComparison || left.id.localeCompare(right.id);
    });
    const cursorIndex = value.cursor ? sorted.findIndex(document => document.id === value.cursor?.id) : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    pageDocuments = sorted.slice(start, start + value.pageSize);
    hasMore = start + value.pageSize < sorted.length;
    total = sorted.length;
  } else {
    const suffix = direction === "asc" ? "Asc" : "Desc";
    const sortField = value.sortBy === "shop" ? "normalizedShopName" : `${value.sortBy}${suffix}`;
    let pageQuery = baseQuery.orderBy(sortField, direction).orderBy(FieldPath.documentId(), direction);
    if (value.cursor) pageQuery = pageQuery.startAfter(value.cursor.value, value.cursor.id);
    const [pageSnapshot, countSnapshot] = await Promise.all([
      pageQuery.limit(value.pageSize + 1).get(),
      baseQuery.count().get(),
    ]);
    hasMore = pageSnapshot.size > value.pageSize;
    pageDocuments = pageSnapshot.docs.slice(0, value.pageSize);
    total = countSnapshot.data().count;
  }
  const metaSnapshot = await monthReference.get();
  const previousReferences = pageDocuments.map(document => adminDb.collection("dashboardSummaries").doc(previousMonth).collection("shops").doc(document.id));
  const previousDocuments = previousReferences.length ? await adminDb.getAll(...previousReferences) : [];
  const previousById = new Map(previousDocuments.map(document => [document.id, document.data() as ShopSummary | undefined]));
  const rows = pageDocuments.map(document => {
    const summary = document.data() as ShopSummary;
    const previous = previousById.get(document.id);
    return {
      shop: { id: document.id, name: summary.shopName, ...(summary.supervisorId ? { supervisorId: summary.supervisorId } : {}) },
      revenue: summary.revenue,
      totalAchievement: summary.achievement,
      forecastAchievement: summary.hasData && !summary.isFinal ? summary.forecast : null,
      isFinal: summary.isFinal,
      hasData: summary.hasData,
      previousAchievement: previous?.hasData ? previous.achievement : null,
      previousRevenue: previous?.hasData ? previous.revenue : null,
    } satisfies DashboardRow;
  });

  let summary: DashboardSummary;
  if (normalizedSearch) {
    const matching = await baseQuery.get();
    const previous = matching.empty ? [] : await adminDb.getAll(...matching.docs.map(document => adminDb.collection("dashboardSummaries").doc(previousMonth).collection("shops").doc(document.id)));
    summary = summaryFromDocuments(matching.docs, previous);
  } else {
    const meta = metaSnapshot.data() as MonthMeta;
    const previousMeta = (await adminDb.collection("dashboardSummaries").doc(previousMonth).get()).data() as MonthMeta | undefined;
    const previousHasData = previousMeta !== undefined && previousMeta.summary.forecast !== null;
    summary = {
      ...meta.summary,
      previousAverage: previousHasData ? previousMeta?.summary.average ?? null : null,
      previousRevenue: previousHasData ? previousMeta?.summary.revenue ?? null : null,
    };
  }

  const last = pageDocuments.at(-1);
  const lastValue = last?.data() as ShopSummary | undefined;
  const suffix = direction === "asc" ? "Asc" : "Desc";
  const sortField = value.sortBy === "shop" ? "normalizedShopName" : `${value.sortBy}${suffix}` as keyof ShopSummary;
  const sortValue = !lastValue ? "" : lastValue[sortField] as string | number;
  return {
    rows,
    total,
    nextCursor: hasMore && last && lastValue ? { hasData: lastValue.hasData, value: sortValue, name: lastValue.normalizedShopName, id: last.id } : null,
    summary,
    supervisorRows: (metaSnapshot.data() as MonthMeta).supervisorRows,
  };
}
