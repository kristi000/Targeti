"use server";

import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";

import { getCurrentActor, requireAdmin, requireEditorForShops } from "@/lib/access";
import { adminDb } from "@/lib/firebase-admin";
import { calculateForecastAchievement, getForecastDate } from "@/lib/forecast";
import { isoDateSchema, monthSchema, performanceDataSchema, shopIdSchema, shopSchema, supervisorIdSchema, supervisorSchema } from "@/lib/persistence-schemas";
import { calculateTotalAchievement } from "@/lib/utils";
import { getMonthlyRepresentatives, getOverviewPerformanceData, getPerformanceShopActuals, getShopMetrics, type PerformanceData, type PerformanceMetric, type Shop, type Supervisor } from "@/lib/types";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import type { DashboardCursor, DashboardRepresentativeRow, DashboardRow, DashboardSortKey, DashboardSummary, DashboardSupervisorRow } from "@/lib/dashboard-types";

export type { DashboardCursor, DashboardRepresentativeRow, DashboardRow, DashboardSortKey, DashboardSummary, DashboardSupervisorRow } from "@/lib/dashboard-types";
export type DashboardPeriod = { month: string; reportDate: string | null };

const importChangeReferenceSchema = z.object({
  shopId: shopIdSchema,
  performanceId: shopIdSchema,
}).passthrough();

type ShopSummary = {
  schemaVersion: 4;
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
  representativeRows: Array<Omit<DashboardRepresentativeRow, "rank">>;
  updatedAt: string;
};

type MonthMeta = {
  schemaVersion: 4;
  summary: DashboardSummary;
  supervisorRows: DashboardSupervisorRow[];
  representativeRows: DashboardRepresentativeRow[];
  updatedAt: string;
};

const dashboardPageSchema = z.object({
  month: monthSchema,
  search: z.string().trim().max(120).default(""),
  supervisorId: supervisorIdSchema.nullable().default(null),
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
  const settings = report.metricSettings ?? monthData?.metricSettings ?? shop.metricSettings;
  const metrics = getShopMetrics({ ...shop, metricSettings: settings, metricOrder: report.metricOrder ?? monthData?.metricOrder ?? shop.metricOrder }, targets);
  const actuals = getPerformanceShopActuals(active, metrics);
  const achievement = calculateTotalAchievement(actuals, targets, settings);
  const isFinal = report.reportType === "completedMonth";
  const forecast = isFinal
    ? achievement
    : calculateForecastAchievement(actuals, targets, metrics, getForecastDate(report), settings);
  return { achievement, revenue: report.revenue ?? monthData?.collection ?? 0, forecast, isFinal, hasData: true };
}

function representativeRows(shop: Shop, entries: PerformanceData[]): Array<Omit<DashboardRepresentativeRow, "rank">> {
  const active = getOverviewPerformanceData(entries);
  const report = active[0];
  if (!report) return [];

  const month = report.date.slice(0, 7);
  const representatives = getMonthlyRepresentatives(shop, month);
  const targets = report.targets ?? shop.monthlyData?.[month]?.targets ?? shop.monthlyTargets;
  if (!targets || representatives.length === 0) return [];

  const monthData = shop.monthlyData?.[month];
  const metricSettings = monthData?.metricSettings ?? shop.metricSettings;
  const metrics = getShopMetrics({ ...shop, metricSettings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, targets);
  const equalTargets = getEqualRepresentativeTargets(targets, metrics, representatives.length);
  const totalsByRepresentative = new Map<string, Record<PerformanceMetric, number>>();

  active.forEach(entry => entry.reps.forEach(representative => {
    const totals = totalsByRepresentative.get(representative.repId)
      ?? Object.fromEntries(metrics.map(metric => [metric, 0])) as Record<PerformanceMetric, number>;
    metrics.forEach(metric => { totals[metric] += representative[metric] ?? 0; });
    totalsByRepresentative.set(representative.repId, totals);
  }));

  return representatives.map(representative => {
    const totals = totalsByRepresentative.get(representative.id)
      ?? Object.fromEntries(metrics.map(metric => [metric, 0])) as Record<PerformanceMetric, number>;
    const representativeTargets = monthData?.representativeTargets?.[representative.id] ?? equalTargets;
    return {
      id: representative.id,
      name: representative.name,
      shopId: shop.id,
      shopName: shop.name,
      achievement: calculateTotalAchievement(totals, representativeTargets, metricSettings),
      forecastAchievement: report.reportType === "completedMonth"
        ? null
        : calculateForecastAchievement(totals, representativeTargets, metrics, getForecastDate(report), metricSettings),
    };
  });
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

async function loadLegacyImportReportDate(importId: string) {
  const changes = await adminDb.collection("imports").doc(importId).collection("changes").limit(1).get();
  const change = changes.docs[0];
  if (!change) return null;
  const reference = importChangeReferenceSchema.safeParse(change.data());
  if (!reference.success) return null;
  const performance = await adminDb.collection("shops")
    .doc(reference.data.shopId)
    .collection("performance")
    .doc(reference.data.performanceId)
    .get();
  if (!performance.exists) return null;
  const parsed = performanceDataSchema.safeParse({ id: performance.id, ...performance.data() });
  return parsed.success ? parsed.data.asOfDate ?? parsed.data.date : null;
}

function createShopSummary(shop: Shop, entries: PerformanceData[], supervisors: Map<string, Supervisor>): ShopSummary {
  const result = performanceSummary(shop, entries);
  const supervisor = shop.supervisorId ? supervisors.get(shop.supervisorId) : undefined;
  return {
    schemaVersion: 4,
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
    representativeRows: representativeRows(shop, entries),
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
  const representativeRows = values
    .flatMap(value => value.representativeRows ?? [])
    .sort((left, right) => right.achievement - left.achievement)
    .map((representative, index) => ({ ...representative, rank: index + 1 }));
  return {
    schemaVersion: 4,
    summary: {
      average: reporting.length ? reporting.reduce((sum, value) => sum + value.achievement, 0) / reporting.length : 0,
      forecast: reporting.length ? reporting.reduce((sum, value) => sum + value.forecast, 0) / reporting.length : null,
      revenue: values.reduce((sum, value) => sum + value.revenue, 0),
      allFinal: reporting.length > 0 && reporting.every(value => value.isFinal),
      activeShops: values.length,
      shopsAtTarget: reporting.filter(value => value.achievement >= 100).length,
    },
    supervisorRows,
    representativeRows,
    updatedAt: new Date().toISOString(),
  };
}

async function writeMonthMeta(month: string) {
  const shops = await adminDb.collection("dashboardSummaries").doc(month).collection("shops").get();
  const meta = summarizeDocuments(shops.docs);
  await adminDb.collection("dashboardSummaries").doc(month).set(meta);
  return meta;
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
  return writeMonthMeta(month);
}

async function ensureMonth(month: string) {
  const reference = adminDb.collection("dashboardSummaries").doc(month);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.schemaVersion !== 4) return rebuildMonth(month);
  return snapshot.data() as MonthMeta;
}

export async function fetchPerformanceDataForMonth(month: string): Promise<Record<string, PerformanceData[]>> {
  const actor = await getCurrentActor();
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
    if (!shopId || !entry || (actor.role !== "admin" && !actor.shopIds.includes(shopId))) return;
    (performanceData[shopId] ??= []).push(entry);
  });
  return performanceData;
}

export async function fetchDashboardPeriods(): Promise<DashboardPeriod[]> {
  const actor = await getCurrentActor();
  const [shops, imports] = await Promise.all([
    adminDb.collection("shops").get(),
    adminDb.collection("imports").where("status", "==", "active").orderBy("createdAt", "desc").get(),
  ]);
  const periods = new Map<string, { reportDate: string | null; importedAt: string | null; importId?: string }>();
  const accessibleShopIds = new Set(actor.role === "admin" ? shops.docs.map(document => document.id) : actor.shopIds);
  shops.docs.filter(document => accessibleShopIds.has(document.id)).forEach(document => Object.keys(document.data().monthlyData ?? {}).forEach(month => periods.set(month, { reportDate: null, importedAt: null })));
  imports.docs.forEach(document => {
    const parsed = z.object({ month: monthSchema, createdAt: z.string().datetime({ offset: true }), reportDate: isoDateSchema.optional(), shopIds: z.array(shopIdSchema).optional() }).passthrough().safeParse(document.data());
    if (!parsed.success) return;
    if (actor.role !== "admin" && !parsed.data.shopIds?.some(shopId => accessibleShopIds.has(shopId))) return;
    const current = periods.get(parsed.data.month);
    if (!current?.importedAt) periods.set(parsed.data.month, {
      reportDate: parsed.data.reportDate ?? null,
      importedAt: parsed.data.createdAt,
      importId: document.id,
    });
  });
  if (!periods.size) periods.set(new Date().toISOString().slice(0, 7), { reportDate: null, importedAt: null });

  const legacyImportIds = [...periods.values()].flatMap(period => !period.reportDate && period.importId ? [period.importId] : []);
  const legacyReportDates = new Map((await Promise.all(legacyImportIds.map(async importId => {
    const reportDate = await loadLegacyImportReportDate(importId);
    return [importId, reportDate] as const;
  }))).flatMap(([importId, reportDate]) => reportDate ? [[importId, reportDate]] : []));
  return [...periods].map(([month, period]) => ({
    month,
    ...period,
    reportDate: period.reportDate ?? (period.importId ? legacyReportDates.get(period.importId) ?? null : null),
  })).sort((left, right) => {
    if (left.importedAt && right.importedAt) return right.importedAt.localeCompare(left.importedAt) || right.month.localeCompare(left.month);
    if (left.importedAt) return -1;
    if (right.importedAt) return 1;
    return right.month.localeCompare(left.month);
  }).map(({ month, reportDate }) => ({ month, reportDate }));
}

async function performDashboardSummaryRefresh(input: { shopIds: string[]; months?: string[] }) {
  const value = refreshSchema.parse(input);
  const supervisors = new Map((await loadSupervisors()).map(supervisor => [supervisor.id, supervisor]));
  const touchedMonths = new Set(value.months ?? []);
  if (!value.months) {
    const existingMonths = await adminDb.collection("dashboardSummaries").listDocuments();
    existingMonths.forEach(document => touchedMonths.add(document.id));
  }
  const shops = await Promise.all(value.shopIds.map(shopId => adminDb.collection("shops").doc(shopId).get()));
  const performanceByShop = await Promise.all(shops.map(async shopDocument => {
    if (!shopDocument.exists) return null;
    const performance = shopDocument.ref.collection("performance");
    if (!value.months) return (await performance.get()).docs;
    const snapshots = await Promise.all([...touchedMonths].map(month => performance
      .where("date", ">=", `${month}-01`)
      .where("date", "<=", `${month}-31`)
      .orderBy("date", "asc")
      .get()));
    return snapshots.flatMap(snapshot => snapshot.docs);
  }));
  if (!value.months) {
    shops.forEach((shopDocument, index) => {
      performanceByShop[index]?.forEach(document => {
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
      const entries = performance?.flatMap(document => {
        const entry = parsePerformance(document);
        return entry?.date.startsWith(month) ? [entry] : [];
      }) ?? [];
      await reference.set(createShopSummary(shop, entries, supervisors));
    }
  }
  await Promise.all([...touchedMonths].map(writeMonthMeta));
}

export async function refreshDashboardSummaries(input: { shopIds: string[]; months?: string[] }) {
  const value = refreshSchema.parse(input);
  const actor = await requireEditorForShops(value.shopIds);
  try {
    await performDashboardSummaryRefresh(value);
    return { synchronized: true as const };
  } catch (error) {
    console.error("Dashboard summary refresh failed; scheduling a rebuild.", error);
    try {
      await adminDb.collection("maintenanceJobs").add({
        type: "dashboard-summary-refresh",
        status: "pending",
        input: value,
        requestedAt: new Date().toISOString(),
        requestedBy: actor,
        attempts: 0,
      });
    } catch (queueError) {
      console.error("Dashboard summary refresh could not be queued.", queueError);
    }
    // Source mutations have already committed. Treat summaries as an eventually
    // consistent projection so callers never report those mutations as failed.
    return { synchronized: false as const };
  }
}

export async function retryPendingDashboardSummaryJobs() {
  await requireAdmin();
  const jobs = await adminDb.collection("maintenanceJobs")
    .where("type", "==", "dashboard-summary-refresh")
    .where("status", "==", "pending")
    .limit(20)
    .get();
  let completed = 0;
  for (const job of jobs.docs) {
    const parsed = z.object({ input: refreshSchema, attempts: z.number().int().nonnegative().default(0) }).safeParse(job.data());
    if (!parsed.success) {
      await job.ref.update({ status: "invalid", failedAt: new Date().toISOString() });
      continue;
    }
    try {
      await performDashboardSummaryRefresh(parsed.data.input);
      await job.ref.update({ status: "completed", completedAt: new Date().toISOString(), attempts: parsed.data.attempts + 1 });
      completed += 1;
    } catch (error) {
      await job.ref.update({ attempts: parsed.data.attempts + 1, lastAttemptAt: new Date().toISOString(), lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" });
    }
  }
  return { processed: jobs.size, completed };
}

export async function rebuildDashboardSummaryMonths(months: string[]) {
  await requireAdmin();
  const validMonths = z.array(monthSchema).min(1).max(24).parse(months);
  for (const month of validMonths) await rebuildMonth(month);
  return { rebuilt: validMonths.length };
}

export async function fetchDashboardInsights(month: string): Promise<DashboardSummary> {
  const actor = await getCurrentActor();
  const validMonth = monthSchema.parse(month);
  const meta = await ensureMonth(validMonth);
  if (actor.role === "admin") return meta.summary;
  const documents = await adminDb.collection("dashboardSummaries").doc(validMonth).collection("shops").get();
  return summarizeDocuments(documents.docs.filter(document => actor.shopIds.includes(document.id))).summary;
}

export async function fetchDashboardPage(input: { month: string; search?: string; supervisorId?: string | null; pageSize: number; cursor?: DashboardCursor | null; sortBy?: DashboardSortKey; sortDirection?: "asc" | "desc" }) {
  const actor = await getCurrentActor();
  const value = dashboardPageSchema.parse(input);
  const meta = await ensureMonth(value.month);

  const monthReference = adminDb.collection("dashboardSummaries").doc(value.month);
  let baseQuery: FirebaseFirestore.Query = monthReference.collection("shops");
  const normalizedSearch = normalizeText(value.search);
  if (value.supervisorId) baseQuery = baseQuery.where("supervisorId", "==", value.supervisorId);
  else if (normalizedSearch) baseQuery = baseQuery.where("searchPrefixes", "array-contains", normalizedSearch);

  const direction = value.sortDirection;
  let pageDocuments: FirebaseFirestore.QueryDocumentSnapshot[];
  let matchingDocuments: FirebaseFirestore.QueryDocumentSnapshot[] | null = null;
  let hasMore: boolean;
  let total: number;
  if (normalizedSearch || value.supervisorId || actor.role !== "admin") {
    const matching = await baseQuery.get();
    matchingDocuments = normalizedSearch && value.supervisorId
      ? matching.docs.filter(document => (document.data() as ShopSummary).searchPrefixes.includes(normalizedSearch))
      : matching.docs;
    if (actor.role !== "admin") matchingDocuments = matchingDocuments.filter(document => actor.shopIds.includes(document.id));
    const directionMultiplier = direction === "asc" ? 1 : -1;
    const getSortValue = (document: FirebaseFirestore.QueryDocumentSnapshot): string | number => {
      const summary = document.data() as ShopSummary;
      if (value.sortBy === "shop") return summary.normalizedShopName;
      if (!summary.hasData) return direction === "asc" ? Number.MAX_SAFE_INTEGER : -1;
      return value.sortBy === "achievement" ? summary.achievement : value.sortBy === "forecast" ? summary.forecast : summary.revenue;
    };
    const sorted = [...matchingDocuments].sort((left, right) => {
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
    const pageSnapshot = await pageQuery.limit(value.pageSize + 1).get();
    hasMore = pageSnapshot.size > value.pageSize;
    pageDocuments = pageSnapshot.docs.slice(0, value.pageSize);
    total = meta.summary.activeShops;
  }
  const rows = pageDocuments.map(document => {
    const summary = document.data() as ShopSummary;
    return {
      shop: { id: document.id, name: summary.shopName, ...(summary.supervisorId ? { supervisorId: summary.supervisorId } : {}) },
      revenue: summary.revenue,
      totalAchievement: summary.achievement,
      forecastAchievement: summary.hasData && !summary.isFinal ? summary.forecast : null,
      isFinal: summary.isFinal,
      hasData: summary.hasData,
    } satisfies DashboardRow;
  });

  const scopedMeta = matchingDocuments ? summarizeDocuments(matchingDocuments) : meta;
  const summary = scopedMeta.summary;

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
    supervisorRows: scopedMeta.supervisorRows,
    representativeRows: scopedMeta.representativeRows,
  };
}
