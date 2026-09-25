"use server";

import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";

import { getCurrentActor, requireAdmin, requireEditorForShops } from "@/lib/access";
import { markPerformanceIndexesDirty, syncPerformanceIndexes } from "@/lib/performance-index";
import { loadDashboardPeriodSources, markDashboardPeriodIndexDirty, syncDashboardPeriodIndex } from "@/lib/dashboard-period-index";
import { adminDb } from "@/lib/firebase-admin";
import { calculateForecastAchievement, getForecastDate } from "@/lib/forecast";
import { monthSchema, performanceDataSchema, shopIdSchema, shopSchema, supervisorIdSchema, supervisorSchema } from "@/lib/persistence-schemas";
import { calculateTotalAchievement } from "@/lib/utils";
import { getMonthlyRepresentatives, getOverviewPerformanceData, getPerformanceShopActuals, getShopMetrics, type PerformanceData, type PerformanceMetric, type Shop, type Supervisor } from "@/lib/types";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import type { DashboardRepresentativeRow, DashboardRow, DashboardSortKey, DashboardSummary, DashboardSupervisorRow } from "@/lib/dashboard-types";

export type { DashboardRepresentativeRow, DashboardRow, DashboardSortKey, DashboardSummary, DashboardSupervisorRow } from "@/lib/dashboard-types";
export type DashboardPeriod = { month: string; reportDate: string | null };

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

type SearchEntry = Pick<ShopSummary,
  "shopId" | "shopName" | "normalizedShopName" | "supervisorId" | "supervisorName"
  | "achievement" | "achievementAsc" | "achievementDesc" | "forecast" | "forecastAsc"
  | "forecastDesc" | "revenue" | "revenueAsc" | "revenueDesc" | "isFinal" | "hasData"
>;

const searchEntrySchema = z.object({
  shopId: shopIdSchema,
  shopName: z.string().min(1).max(120),
  normalizedShopName: z.string().min(1).max(120),
  supervisorId: supervisorIdSchema.nullable(),
  supervisorName: z.string().nullable(),
  achievement: z.number().finite(),
  achievementAsc: z.number().finite(),
  achievementDesc: z.number().finite(),
  forecast: z.number().finite(),
  forecastAsc: z.number().finite(),
  forecastDesc: z.number().finite(),
  revenue: z.number().finite(),
  revenueAsc: z.number().finite(),
  revenueDesc: z.number().finite(),
  isFinal: z.boolean(),
  hasData: z.boolean(),
});
const searchIndexSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().datetime({ offset: true }),
  entries: z.array(searchEntrySchema).max(5000),
});
const MAX_SEARCH_INDEX_BYTES = 750_000;

type MonthMeta = {
  schemaVersion: 4;
  summary: DashboardSummary;
  searchIndexAvailable?: boolean;
  supervisorSummaries?: Record<string, DashboardSummary>;
  supervisorRows: DashboardSupervisorRow[];
  representativeRows: Array<DashboardRepresentativeRow & { supervisorId?: string | null }>;
  updatedAt: string;
};

const dashboardPageSchema = z.object({
  month: monthSchema,
  search: z.string().trim().max(120).default(""),
  supervisorId: supervisorIdSchema.nullable().default(null),
  sortBy: z.enum(["shop", "achievement", "forecast", "revenue"]).default("shop"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

const refreshSchema = z.object({
  shopIds: z.array(shopIdSchema).min(1).max(500),
  months: z.array(monthSchema).max(120).optional(),
  performanceChanged: z.boolean().optional(),
  periodsChanged: z.boolean().optional(),
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

function searchEntryMatches(entry: SearchEntry, search: string) {
  return [entry.shopName, entry.supervisorName].some(value => {
    if (!value) return false;
    const normalized = normalizeText(value);
    return normalized.startsWith(search) || normalized.split(" ").some(word => word.startsWith(search));
  });
}

function compareSearchEntries(left: SearchEntry, right: SearchEntry, sortBy: DashboardSortKey, direction: "asc" | "desc") {
  const field = sortBy === "shop" ? "normalizedShopName" : `${sortBy}${direction === "asc" ? "Asc" : "Desc"}` as keyof SearchEntry;
  const leftValue = left[field];
  const rightValue = right[field];
  const comparison = typeof leftValue === "string" && typeof rightValue === "string"
    ? leftValue.localeCompare(rightValue)
    : Number(leftValue) - Number(rightValue);
  if (comparison) return comparison * (direction === "asc" ? 1 : -1);
  return left.normalizedShopName.localeCompare(right.normalizedShopName) || left.shopId.localeCompare(right.shopId);
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

type SummaryValue = Pick<ShopSummary, "supervisorId" | "supervisorName" | "achievement" | "forecast" | "revenue" | "isFinal" | "hasData">;

function summarizeValues(values: SummaryValue[]): DashboardSummary {
  const reporting = values.filter(value => value.hasData);
  return {
    average: reporting.length ? reporting.reduce((sum, value) => sum + value.achievement, 0) / reporting.length : 0,
    forecast: reporting.length ? reporting.reduce((sum, value) => sum + value.forecast, 0) / reporting.length : null,
    revenue: values.reduce((sum, value) => sum + value.revenue, 0),
    allFinal: reporting.length > 0 && reporting.every(value => value.isFinal),
    activeShops: values.length,
    shopsAtTarget: reporting.filter(value => value.achievement >= 100).length,
  };
}

function summarizeSupervisorRows(values: SummaryValue[]): DashboardSupervisorRow[] {
  const supervisors = new Map<string, { name: string; values: SummaryValue[] }>();
  values.forEach(value => {
    if (!value.supervisorId) return;
    const current = supervisors.get(value.supervisorId) ?? { name: value.supervisorName ?? value.supervisorId, values: [] };
    current.values.push(value);
    supervisors.set(value.supervisorId, current);
  });
  return [...supervisors].map(([id, group]) => {
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
}

function summarizeDocuments(documents: FirebaseFirestore.QueryDocumentSnapshot[]): MonthMeta {
  const values = documents.map(document => document.data() as ShopSummary);
  const supervisorRows = summarizeSupervisorRows(values);
  const supervisors = new Map<string, ShopSummary[]>();
  values.forEach(value => {
    if (!value.supervisorId) return;
    const group = supervisors.get(value.supervisorId) ?? [];
    group.push(value);
    supervisors.set(value.supervisorId, group);
  });
  const representativeRows = values
    .flatMap(value => (value.representativeRows ?? []).map(row => ({ ...row, supervisorId: value.supervisorId })))
    .sort((left, right) => right.achievement - left.achievement)
    .map((representative, index) => ({ ...representative, rank: index + 1 }));
  return {
    schemaVersion: 4,
    summary: summarizeValues(values),
    supervisorSummaries: Object.fromEntries([...supervisors].map(([id, group]) => [id, summarizeValues(group)])),
    supervisorRows,
    representativeRows,
    updatedAt: new Date().toISOString(),
  };
}

async function writeMonthMeta(month: string) {
  const monthReference = adminDb.collection("dashboardSummaries").doc(month);
  const shops = await monthReference.collection("shops").get();
  const searchEntries: SearchEntry[] = shops.docs.map(document => {
    const summary = document.data() as ShopSummary;
    return {
      shopId: document.id,
      shopName: summary.shopName,
      normalizedShopName: summary.normalizedShopName,
      supervisorId: summary.supervisorId,
      supervisorName: summary.supervisorName,
      achievement: summary.achievement,
      achievementAsc: summary.achievementAsc,
      achievementDesc: summary.achievementDesc,
      forecast: summary.forecast,
      forecastAsc: summary.forecastAsc,
      forecastDesc: summary.forecastDesc,
      revenue: summary.revenue,
      revenueAsc: summary.revenueAsc,
      revenueDesc: summary.revenueDesc,
      isFinal: summary.isFinal,
      hasData: summary.hasData,
    };
  });
  const canIndexSearch = searchEntries.length <= 5000
    && Buffer.byteLength(JSON.stringify(searchEntries), "utf8") <= MAX_SEARCH_INDEX_BYTES
    && searchEntries.every(entry => searchEntrySchema.safeParse(entry).success);
  const meta = { ...summarizeDocuments(shops.docs), searchIndexAvailable: canIndexSearch };
  const batch = adminDb.batch();
  batch.set(monthReference, meta);
  const indexReference = monthReference.collection("metadata").doc("searchIndex");
  if (canIndexSearch) batch.set(indexReference, { schemaVersion: 1, updatedAt: meta.updatedAt, entries: searchEntries });
  else batch.delete(indexReference);
  await batch.commit();
  return meta;
}

async function loadSearchIndex(month: string, initialMeta: MonthMeta) {
  let meta = initialMeta;
  if (meta.searchIndexAvailable === undefined) {
    try {
      meta = await writeMonthMeta(month);
    } catch (error) {
      console.warn("Dashboard search index could not be built; using matching summary reads.", error);
      return null;
    }
  }
  if (!meta.searchIndexAvailable) return null;
  const reference = adminDb.collection("dashboardSummaries").doc(month).collection("metadata").doc("searchIndex");
  const snapshot = await reference.get();
  const parsed = searchIndexSchema.safeParse(snapshot.data());
  if (!parsed.success || parsed.data.updatedAt !== meta.updatedAt) return null;
  return { meta, entries: parsed.data.entries as SearchEntry[] };
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
  const scopedShopIds = actor.role !== "admin" ? [...new Set(actor.shopIds)] : [];
  const snapshots = actor.role !== "admin" && scopedShopIds.length <= 10
    ? await Promise.all(scopedShopIds.map(shopId => adminDb.collection("shops").doc(shopId).collection("performance")
      .where("date", ">=", `${validMonth}-01`)
      .where("date", "<=", `${validMonth}-31`)
      .orderBy("date", "asc")
      .get()))
    : [await adminDb.collectionGroup("performance")
      .where("date", ">=", `${validMonth}-01`)
      .where("date", "<=", `${validMonth}-31`)
      .orderBy("date", "asc")
      .get()];
  const performanceData: Record<string, PerformanceData[]> = {};
  snapshots.flatMap(snapshot => snapshot.docs).forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    const entry = parsePerformance(document);
    if (!shopId || !entry || (actor.role !== "admin" && !actor.shopIds.includes(shopId))) return;
    (performanceData[shopId] ??= []).push(entry);
  });
  return performanceData;
}

export async function fetchDashboardPeriods(): Promise<DashboardPeriod[]> {
  const actor = await getCurrentActor();
  const sources = await loadDashboardPeriodSources();
  const assignedShopIds = new Set(actor.shopIds);
  const accessibleShops = sources.shopMonths.filter(shop => actor.role === "admin" || assignedShopIds.has(shop.shopId));
  const accessibleShopIds = new Set(accessibleShops.map(shop => shop.shopId));
  const periods = new Map<string, { reportDate: string | null; importedAt: string | null }>();
  accessibleShops.forEach(shop => shop.months.forEach(month => periods.set(month, { reportDate: null, importedAt: null })));
  sources.imports.forEach(item => {
    if (actor.role !== "admin" && !item.shopIds?.some(shopId => accessibleShopIds.has(shopId))) return;
    const current = periods.get(item.month);
    if (!current?.importedAt) periods.set(item.month, {
      reportDate: item.reportDate,
      importedAt: item.createdAt,
    });
  });
  if (!periods.size) periods.set(new Date().toISOString().slice(0, 7), { reportDate: null, importedAt: null });
  return [...periods].map(([month, period]) => ({
    month,
    ...period,
  })).sort((left, right) => {
    if (left.importedAt && right.importedAt) return right.importedAt.localeCompare(left.importedAt) || right.month.localeCompare(left.month);
    if (left.importedAt) return -1;
    if (right.importedAt) return 1;
    return right.month.localeCompare(left.month);
  }).map(({ month, reportDate }) => ({ month, reportDate }));
}

async function performDashboardSummaryRefresh(input: z.infer<typeof refreshSchema>) {
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

async function refreshDashboardProjections(input: z.infer<typeof refreshSchema>) {
  const [performanceRefreshId, periodsRefreshId] = await Promise.all([
    input.performanceChanged ? markPerformanceIndexesDirty(input.shopIds) : Promise.resolve(null),
    input.periodsChanged ? markDashboardPeriodIndexDirty() : Promise.resolve(null),
  ]);
  await Promise.all([
    performDashboardSummaryRefresh(input),
    performanceRefreshId ? syncPerformanceIndexes(input.shopIds, performanceRefreshId) : Promise.resolve(),
    periodsRefreshId ? syncDashboardPeriodIndex(periodsRefreshId) : Promise.resolve(),
  ]);
}

export async function refreshDashboardSummaries(input: { shopIds: string[]; months?: string[]; performanceChanged?: boolean; periodsChanged?: boolean }) {
  const value = refreshSchema.parse(input);
  const actor = await requireEditorForShops(value.shopIds);
  try {
    await refreshDashboardProjections(value);
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
      await refreshDashboardProjections(parsed.data.input);
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
  const scopedShopIds = [...new Set(actor.shopIds)];
  if (!scopedShopIds.length) return summarizeValues([]);
  const summaries = adminDb.collection("dashboardSummaries").doc(validMonth).collection("shops");
  const documents = scopedShopIds.length <= 10
    ? await summaries.where(FieldPath.documentId(), "in", scopedShopIds).get()
    : await summaries.get();
  return summarizeDocuments(documents.docs.filter(document => actor.shopIds.includes(document.id))).summary;
}

export async function fetchDashboardPage(input: { month: string; search?: string; supervisorId?: string | null; sortBy?: DashboardSortKey; sortDirection?: "asc" | "desc" }) {
  const actor = await getCurrentActor();
  const value = dashboardPageSchema.parse(input);
  let meta = await ensureMonth(value.month);

  const monthReference = adminDb.collection("dashboardSummaries").doc(value.month);
  let baseQuery: FirebaseFirestore.Query = monthReference.collection("shops");
  const normalizedSearch = normalizeText(value.search);
  if (value.supervisorId) baseQuery = baseQuery.where("supervisorId", "==", value.supervisorId);
  else if (normalizedSearch) baseQuery = baseQuery.where("searchPrefixes", "array-contains", normalizedSearch);

  const direction = value.sortDirection;
  let pageDocuments: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let matchingDocuments: FirebaseFirestore.QueryDocumentSnapshot[] | null = null;
  let total = 0;
  let searchPageEntries: SearchEntry[] | null = null;
  let searchMeta: MonthMeta | null = null;
  let supervisorMeta: MonthMeta | null = null;
  if (actor.role === "admin" && normalizedSearch) {
    const indexed = await loadSearchIndex(value.month, meta);
    if (indexed) {
      meta = indexed.meta;
      const matches = indexed.entries.filter(entry => searchEntryMatches(entry, normalizedSearch)
        && (!value.supervisorId || entry.supervisorId === value.supervisorId));
      const sorted = matches.sort((left, right) => compareSearchEntries(left, right, value.sortBy, direction));
      searchPageEntries = sorted;
      total = sorted.length;
      const matchingIds = new Set(sorted.map(entry => entry.shopId));
      const representativeRows = meta.representativeRows.filter(row => matchingIds.has(row.shopId))
        .map((row, index) => ({ ...row, rank: index + 1 }));
      searchMeta = {
        ...meta,
        summary: summarizeValues(sorted),
        supervisorRows: summarizeSupervisorRows(sorted),
        representativeRows,
      };
    }
  }
  if (!searchMeta && actor.role === "admin" && value.supervisorId && !normalizedSearch) {
    if (!meta.supervisorSummaries || meta.representativeRows.some(row => !("supervisorId" in row))) {
      try {
        meta = await writeMonthMeta(value.month);
      } catch (error) {
        console.warn("Supervisor dashboard aggregates could not be stored; using matching summary reads.", error);
      }
    }
    if (meta.supervisorSummaries && meta.representativeRows.every(row => "supervisorId" in row)) {
      const supervisorId = value.supervisorId;
      const suffix = direction === "asc" ? "Asc" : "Desc";
      const sortField = value.sortBy === "shop" ? "normalizedShopName" : `${value.sortBy}${suffix}`;
      let pageQuery = baseQuery.orderBy(sortField, direction);
      if (value.sortBy !== "shop") pageQuery = pageQuery.orderBy("normalizedShopName", "asc");
      pageQuery = pageQuery.orderBy(FieldPath.documentId(), "asc");
      try {
        const pageSnapshot = await pageQuery.get();
        pageDocuments = pageSnapshot.docs;
        const representativeRows = meta.representativeRows.filter(row => row.supervisorId === supervisorId)
          .map((row, index) => ({ ...row, rank: index + 1 }));
        supervisorMeta = {
          ...meta,
          summary: meta.supervisorSummaries[supervisorId] ?? summarizeValues([]),
          supervisorRows: meta.supervisorRows.filter(row => row.id === supervisorId),
          representativeRows,
        };
        total = supervisorMeta.summary.activeShops;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code !== 9 && code !== "failed-precondition") throw error;
        console.warn("Supervisor dashboard index is unavailable; using matching summary reads.");
      }
    }
  }
  if (!searchMeta && !supervisorMeta && (normalizedSearch || value.supervisorId || actor.role !== "admin")) {
    const scopedShopIds = actor.role !== "admin" ? [...new Set(actor.shopIds)] : [];
    const useScopedShopQuery = actor.role !== "admin" && scopedShopIds.length <= 10;
    const matching = useScopedShopQuery
      ? scopedShopIds.length
        ? await monthReference.collection("shops").where(FieldPath.documentId(), "in", scopedShopIds).get()
        : null
      : await baseQuery.get();
    matchingDocuments = (matching?.docs ?? []).filter(document => {
      const summary = document.data() as ShopSummary;
      return (!normalizedSearch || summary.searchPrefixes.includes(normalizedSearch))
        && (!value.supervisorId || summary.supervisorId === value.supervisorId)
        && (actor.role === "admin" || scopedShopIds.includes(document.id));
    });
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
    pageDocuments = sorted;
    total = sorted.length;
  } else if (!searchMeta && !supervisorMeta) {
    const suffix = direction === "asc" ? "Asc" : "Desc";
    const sortField = value.sortBy === "shop" ? "normalizedShopName" : `${value.sortBy}${suffix}`;
    const pageQuery = baseQuery.orderBy(sortField, direction).orderBy(FieldPath.documentId(), direction);
    const pageSnapshot = await pageQuery.get();
    pageDocuments = pageSnapshot.docs;
    total = meta.summary.activeShops;
  }
  const rows = (searchPageEntries ?? pageDocuments.map(document => ({ shopId: document.id, ...document.data() } as ShopSummary))).map(summary => {
    return {
      shop: { id: summary.shopId, name: summary.shopName, ...(summary.supervisorId ? { supervisorId: summary.supervisorId } : {}) },
      revenue: summary.revenue,
      totalAchievement: summary.achievement,
      forecastAchievement: summary.hasData && !summary.isFinal ? summary.forecast : null,
      isFinal: summary.isFinal,
      hasData: summary.hasData,
    } satisfies DashboardRow;
  });

  const scopedMeta = searchMeta ?? supervisorMeta ?? (matchingDocuments ? summarizeDocuments(matchingDocuments) : meta);
  const summary = scopedMeta.summary;

  return {
    rows,
    total,
    summary,
    supervisorRows: scopedMeta.supervisorRows,
    representativeRows: scopedMeta.representativeRows,
  };
}
