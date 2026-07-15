"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  documentId,
  endAt,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  startAt,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "@/lib/firebase-admin";
import { format, getDaysInMonth, parseISO, subMonths } from "date-fns";
import { z } from "zod";

import { adminAuth, adminDb as db } from "@/lib/firebase-admin";
import { getCurrentActor, requireAdmin, requireEditor } from "@/lib/access";
import { getMetricWeight } from "@/lib/data";
import { calculateTotalAchievement } from "@/lib/utils";
import {
  bonusSnapshotSchema,
  activityEventSchema,
  newShopSchema,
  performanceDataListSchema,
  performanceDataSchema,
  metricKeySchema,
  monthSchema,
  shopIdSchema,
  shopSchema,
  targetSchema,
} from "@/lib/persistence-schemas";
import { getInitialTargets, getOverviewPerformanceData, getPerformanceShopActuals, getQuarterKey, getShopMetrics, type ActivityEvent, type BonusSnapshot, type MetricSettings, type PerformanceData, type PerformanceMetric, type Shop, type Target } from "@/lib/types";

export type ShopData = {
  shops: Shop[];
  performanceData: Record<string, PerformanceData[]>;
  monthlyTargets: Record<string, Target>;
};

const SHOP_DATA_CACHE_TAG = "shop-data";

function invalidateShopData() {
  revalidateTag(SHOP_DATA_CACHE_TAG);
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid data.";
}

function mutationError(operation: string, error: unknown) {
  if (error instanceof z.ZodError) return validationMessage(error);
  if (error instanceof Error && error.message === "UNAUTHENTICATED") return "Your session has expired. Please sign in again.";
  if (error instanceof Error && error.message === "ADMIN_REQUIRED") return "Administrator permission is required for this action.";
  if (error instanceof Error && error.message === "EDITOR_REQUIRED") return "Editor permission is required for this action.";
  console.error(`Firestore ${operation} failed:`, error);
  return `Could not ${operation}. Please try again.`;
}

async function recordActivity(event: Omit<ActivityEvent, "id" | "occurredAt" | "actor">) {
  const value = activityEventSchema.omit({ id: true }).parse({
    ...event,
    occurredAt: new Date().toISOString(),
    actor: await getCurrentActor(),
  });
  await addDoc(collection(db, "activity"), toFirestoreData(value));
}

function parseFirestoreDocument<T>(schema: z.ZodType<T>, id: string, value: unknown): T | null {
  const result = schema.safeParse({ id, ...(value as Record<string, unknown>) });
  if (result.success) return result.data;
  console.error(`Ignoring invalid Firestore document ${id}:`, result.error.flatten());
  return null;
}

function toFirestoreData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => toFirestoreData(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, toFirestoreData(entry)]],
      ),
    ) as T;
  }
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
  return value;
}

export async function handleSaveTargets(shopId: string, targets: Target) {
  try {
    await requireEditor();
    const validShopId = shopIdSchema.parse(shopId);
    const validTargets = targetSchema.parse(targets) as Target;
    await updateDoc(doc(db, "shops", validShopId), { monthlyTargets: validTargets });
    const shop = (await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShopId), limit(1)))).docs[0];
    await recordActivity({ action: "targets_changed", summary: `Changed targets for ${shop?.data().name ?? validShopId}.`, shopIds: [validShopId], shopNames: [shop?.data().name ?? validShopId] });
    invalidateShopData();
    return { success: true as const, data: validTargets };
  } catch (error) {
    return { success: false as const, error: mutationError("save targets", error) };
  }
}

async function savePerformanceData(shopId: string, data: PerformanceData[], useImportId: boolean) {
  const validShopId = shopIdSchema.parse(shopId);
  // Zod's catch-all output cannot express the mixed repId/metric index signature,
  // but the schema has validated every property before this conversion.
  const validData = performanceDataListSchema.parse(data) as unknown as PerformanceData[];
  const batch = writeBatch(db);

  validData.forEach(entry => {
    const documentId = useImportId ? entry.importId ?? entry.date : entry.date;
    batch.set(doc(db, "shops", validShopId, "performance", documentId), toFirestoreData(entry));
  });

  await batch.commit();
  invalidateShopData();
  return validData;
}

export async function handleSavePerformanceData(shopId: string, data: PerformanceData[]) {
  try {
    await requireEditor();
    const validData = await savePerformanceData(shopId, data, false);
    return { success: true as const, data: validData };
  } catch (error) {
    return { success: false as const, error: mutationError("save performance data", error) };
  }
}

export async function handleSaveExcelPerformanceData(shopId: string, data: PerformanceData[]) {
  try {
    await requireEditor();
    const validData = await savePerformanceData(shopId, data, true);
    return { success: true as const, data: validData };
  } catch (error) {
    return { success: false as const, error: mutationError("save Excel performance data", error) };
  }
}

export async function saveBonusSnapshot(shopId: string, snapshot: BonusSnapshot) {
  try {
    await requireEditor();
    const validShopId = shopIdSchema.parse(shopId);
    const validSnapshot = bonusSnapshotSchema.parse(snapshot) as BonusSnapshot;
    const snapshotRef = doc(db, "shops", validShopId, "bonusSnapshots", validSnapshot.month);

    await runTransaction(db, async transaction => {
      if ((await transaction.get(snapshotRef)).exists) throw new Error("ALREADY_FINALIZED");
      transaction.set(snapshotRef, toFirestoreData(validSnapshot));
    });

    return { success: true as const, data: validSnapshot };
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_FINALIZED") {
      return { success: false as const, error: "This month has already been finalized." };
    }
    return { success: false as const, error: mutationError("finalize the payroll snapshot", error) };
  }
}

export async function fetchBonusSnapshots(shopId: string): Promise<Record<string, BonusSnapshot>> {
  await getCurrentActor();
  const validShopId = shopIdSchema.parse(shopId);
  const snapshot = await getDocs(collection(db, "shops", validShopId, "bonusSnapshots"));

  return Object.fromEntries(snapshot.docs.flatMap(document => {
    const result = bonusSnapshotSchema.safeParse(document.data());
    if (result.success) return [[document.id, result.data as BonusSnapshot] as const];
    console.error(`Ignoring invalid bonus snapshot ${document.ref.path}:`, result.error.flatten());
    return [];
  }));
}

export async function handleAddShop(shopName: string, description?: string) {
  try {
    await requireEditor();
    const input = newShopSchema.parse({ name: shopName, description });
    const monthlyTargets = getInitialTargets();
    const shopData = {
      name: input.name,
      description: input.description ?? "",
      salesRepresentatives: [],
      monthlyTargets,
      createdAt: new Date().toISOString(),
    };
    const document = await addDoc(collection(db, "shops"), toFirestoreData(shopData));
    await recordActivity({ action: "shop_created", summary: `Created shop ${shopData.name}.`, shopIds: [document.id], shopNames: [shopData.name] });
    invalidateShopData();

    return {
      success: true as const,
      data: { id: document.id, ...shopData } satisfies Shop,
    };
  } catch (error) {
    return { success: false as const, error: mutationError("add the shop", error) };
  }
}

export async function handleUpdateShop(shop: Shop) {
  try {
    await requireEditor();
    const validShop = shopSchema.parse(shop) as Shop;
    const { id, ...shopData } = validShop;
    await updateDoc(doc(db, "shops", id), toFirestoreData(shopData));
    await recordActivity({ action: "shop_edited", summary: `Edited shop ${validShop.name}.`, shopIds: [id], shopNames: [validShop.name] });
    invalidateShopData();
    return { success: true as const, data: validShop };
  } catch (error) {
    return { success: false as const, error: mutationError("update the shop", error) };
  }
}

export async function handleDeleteShop(shopId: string) {
  try {
    await requireAdmin();
    const validShopId = shopIdSchema.parse(shopId);
    const shopRef = doc(db, "shops", validShopId);
    const shopSnapshot = await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShopId), limit(1)));
    const shopName = shopSnapshot.docs[0]?.data().name ?? validShopId;
    const [performance, bonusSnapshots] = await Promise.all([
      getDocs(collection(db, "shops", validShopId, "performance")),
      getDocs(collection(db, "shops", validShopId, "bonusSnapshots")),
    ]);
    const batch = writeBatch(db);
    performance.docs.forEach(item => batch.delete(item.ref));
    bonusSnapshots.docs.forEach(item => batch.delete(item.ref));
    batch.delete(shopRef);
    await batch.commit();
    await recordActivity({ action: "shop_deleted", summary: `Deleted shop ${shopName}.`, shopIds: [validShopId], shopNames: [shopName] });
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("delete the shop", error) };
  }
}

export async function handleClearAllData() {
  try {
    await requireAdmin();
    const shops = await getDocs(collection(db, "shops"));
    const references: DocumentReference[] = [];
    await Promise.all(shops.docs.map(async shop => {
      const [performance, bonusSnapshots] = await Promise.all([
        getDocs(collection(db, "shops", shop.id, "performance")),
        getDocs(collection(db, "shops", shop.id, "bonusSnapshots")),
      ]);
      references.push(...performance.docs.map(item => item.ref));
      references.push(...bonusSnapshots.docs.map(item => item.ref));
      references.push(shop.ref);
    }));
    for (let start = 0; start < references.length; start += 450) {
      const batch = writeBatch(db);
      references.slice(start, start + 450).forEach(reference => batch.delete(reference));
      await batch.commit();
    }
    await recordActivity({ action: "all_data_deleted", summary: `Deleted all application data (${shops.size} shops).`, shopIds: shops.docs.map(item => item.id), shopNames: shops.docs.map(item => String(item.data().name ?? item.id)), metadata: { shopCount: shops.size } });
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("clear application data", error) };
  }
}

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
    await requireEditor();
    const input = bulkMetricWeightsSchema.parse({ month, weights, shopIds }) as { month: string; shopIds: string[]; weights: Record<PerformanceMetric, number> };
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
      const { id, ...shopData } = shopSchema.parse(nextShop) as Shop;
      batch.set(document.ref, toFirestoreData(shopData));
    });

    await batch.commit();
    invalidateShopData();
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
      const { id, ...shopData } = nextShop;
      return [{ reference: document.ref, data: toFirestoreData(shopData) }];
    });

    for (let start = 0; start < writes.length; start += 450) {
      const batch = writeBatch(db);
      writes.slice(start, start + 450).forEach(write => batch.set(write.reference, write.data));
      await batch.commit();
    }
    invalidateShopData();
    await recordActivity({ action: "metric_deleted", summary: `Removed metric ${validMetric} from ${selectedDocuments.length} shop(s).`, shopIds: selectedDocuments.map(item => item.id), shopNames: selectedDocuments.map(item => String(item.data().name ?? item.id)), metadata: { metric: validMetric, shopCount: selectedDocuments.length } });
    return { success: true as const, shops: selectedDocuments.length };
  } catch (error) {
    return { success: false as const, error: mutationError("remove the metric from the selected shops", error) };
  }
}

export async function handleRestoreMetricToShops(metric: string, shopIds: string[]) {
  try {
    await requireEditor();
    const input = selectedMetricRemovalSchema.parse({ metric, shopIds });
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
      const { id, ...shopData } = nextShop;
      writes.push({ reference: document.ref, data: toFirestoreData(shopData) });

      const performance = await getDocs(collection(db, "shops", document.id, "performance"));
      performance.docs.forEach(performanceDocument => {
        const parsed = performanceDataSchema.safeParse({ id: performanceDocument.id, ...performanceDocument.data() });
        if (!parsed.success) return;
        const nextPerformance = performanceDataSchema.parse(restoreMetricToPerformance(parsed.data as unknown as PerformanceData, validMetric)) as unknown as PerformanceData;
        const { id: _id, ...performanceData } = nextPerformance;
        writes.push({ reference: performanceDocument.ref, data: toFirestoreData(performanceData) });
      });
    }));

    for (let start = 0; start < writes.length; start += 450) {
      const batch = writeBatch(db);
      writes.slice(start, start + 450).forEach(write => batch.set(write.reference, write.data));
      await batch.commit();
    }
    invalidateShopData();
    return { success: true as const, shops: selectedDocuments.length };
  } catch (error) {
    return { success: false as const, error: mutationError("restore the metric for the selected shops", error) };
  }
}

async function loadShops(): Promise<Shop[]> {
  const snapshot = await getDocs(collection(db, "shops"));
  return snapshot.docs.flatMap(document => {
    const shop = parseFirestoreDocument(shopSchema, document.id, document.data());
    return shop ? [shop as Shop] : [];
  });
}

export async function fetchShops(): Promise<Shop[]> {
  await getCurrentActor();
  return loadShops();
}

export async function fetchPerformanceData(shopId: string): Promise<PerformanceData[]> {
  await getCurrentActor();
  const validShopId = shopIdSchema.parse(shopId);
  const snapshot = await getDocs(collection(db, "shops", validShopId, "performance"));
  return snapshot.docs.flatMap(document => {
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) return [result.data as unknown as PerformanceData];
    console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
    return [];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

const loadShopData = unstable_cache(async (): Promise<ShopData> => {
  const [shops, performanceSnapshot] = await Promise.all([
    loadShops(),
    getDocs(collectionGroup(db, "performance")),
  ]);
  const performanceData = Object.fromEntries(shops.map(shop => [shop.id, [] as PerformanceData[]]));

  performanceSnapshot.forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    if (!shopId || !performanceData[shopId]) return;
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (result.success) performanceData[shopId].push(result.data as unknown as PerformanceData);
    else console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
  });
  Object.values(performanceData).forEach(entries => entries.sort((left, right) => left.date.localeCompare(right.date)));

  return {
    shops,
    performanceData,
    monthlyTargets: Object.fromEntries(
      shops.flatMap(shop => shop.monthlyTargets ? [[shop.id, shop.monthlyTargets] as const] : []),
    ),
  };
}, [SHOP_DATA_CACHE_TAG], { revalidate: 60, tags: [SHOP_DATA_CACHE_TAG] });

export async function fetchShopData(): Promise<ShopData> {
  await getCurrentActor();
  return loadShopData();
}

export async function fetchAccessProfile() {
  return getCurrentActor();
}

const appRoleSchema = z.enum(["admin", "editor", "viewer"]);

export type AuthUser = {
  uid: string;
  email: string;
  name: string;
  role: z.infer<typeof appRoleSchema>;
  lastSignInAt: string | null;
};

export async function fetchAuthUsers(): Promise<AuthUser[]> {
  await requireAdmin();
  const result = await adminAuth.listUsers(1000);
  return result.users.flatMap(user => user.email ? [{
    uid: user.uid,
    email: user.email,
    name: user.displayName?.trim() || user.email.split("@")[0],
    role: appRoleSchema.catch("viewer").parse(user.customClaims?.role),
    lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
  }] : []).sort((left, right) => left.name.localeCompare(right.name));
}

export async function handleSetUserRole(uid: string, role: "admin" | "editor" | "viewer") {
  try {
    const actor = await requireAdmin();
    const validUid = z.string().trim().min(1).max(128).parse(uid);
    const validRole = appRoleSchema.parse(role);
    if (actor.id === validUid && validRole !== "admin") throw new Error("SELF_DEMOTION");
    const user = await adminAuth.getUser(validUid);
    const currentRole = appRoleSchema.catch("viewer").parse(user.customClaims?.role);
    if (currentRole === validRole) return { success: true as const, role: validRole };
    await adminAuth.setCustomUserClaims(validUid, { ...user.customClaims, role: validRole });
    await adminAuth.revokeRefreshTokens(validUid);
    await recordActivity({ action: "user_role_changed", summary: `Changed ${user.email ?? validUid} to ${validRole}.`, shopIds: [], shopNames: [], metadata: { userId: validUid, role: validRole } });
    return { success: true as const, role: validRole };
  } catch (error) {
    if (error instanceof Error && error.message === "SELF_DEMOTION") return { success: false as const, error: "You cannot remove your own administrator role." };
    return { success: false as const, error: mutationError("change the user role", error) };
  }
}

const activityCursorSchema = z.object({ occurredAt: z.string().datetime({ offset: true }), id: shopIdSchema }).optional();

export async function fetchActivityPage(cursor?: { occurredAt: string; id: string }) {
  await getCurrentActor();
  const validCursor = activityCursorSchema.parse(cursor);
  const constraints = [orderBy("occurredAt", "desc"), orderBy(documentId(), "desc"), ...(validCursor ? [startAfter(validCursor.occurredAt, validCursor.id)] : []), limit(21)];
  const snapshot = await getDocs(query(collection(db, "activity"), ...constraints));
  const hasMore = snapshot.docs.length > 20;
  const documents = snapshot.docs.slice(0, 20);
  const events = documents.flatMap(document => {
    const parsed = activityEventSchema.safeParse({ id: document.id, ...document.data() });
    return parsed.success ? [parsed.data as ActivityEvent] : [];
  });
  const last = documents.at(-1);
  return {
    events,
    nextCursor: hasMore && last ? { occurredAt: String(last.data().occurredAt), id: last.id } : null,
  };
}

export type DashboardCursor = { name: string; id: string };
export type DashboardRow = {
  shop: Shop;
  revenue: number;
  totalAchievement: number;
  forecastAchievement: number | null;
  isFinal: boolean;
  hasData: boolean;
  previousAchievement: number | null;
  previousRevenue: number | null;
};

const dashboardPageSchema = z.object({
  month: monthSchema,
  search: z.string().trim().max(120).default(""),
  pageSize: z.number().int().min(5).max(50),
  cursor: z.object({ name: z.string().min(1).max(120), id: shopIdSchema }).nullable().optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});

const importChangeSchema = z.object({
  shopId: shopIdSchema,
  shopName: z.string().trim().min(1).max(120),
  performanceId: shopIdSchema,
  previousShop: shopSchema.nullable(),
  importedShop: shopSchema,
}).strict();

export async function handleRegisterImport(importId: string, fileName: string, month: string, changes: Array<{ shopId: string; shopName: string; performanceId: string; previousShop: Shop | null; importedShop: Shop }>) {
  try {
    await requireEditor();
    const validImportId = shopIdSchema.parse(importId);
    const validFileName = z.string().trim().min(1).max(255).parse(fileName);
    const validMonth = monthSchema.parse(month);
    const validChanges = z.array(importChangeSchema).min(1).max(150).parse(changes) as typeof changes;
    const value = {
      fileName: validFileName,
      month: validMonth,
      createdAt: new Date().toISOString(),
      actor: await getCurrentActor(),
      status: "active",
      recordCount: validChanges.length,
    };
    const batch = writeBatch(db);
    batch.set(doc(db, "imports", validImportId), toFirestoreData(value));
    validChanges.forEach(change => batch.set(doc(db, "imports", validImportId, "changes", change.shopId), toFirestoreData(change)));
    await batch.commit();
    await recordActivity({
      action: "excel_imported",
      summary: `Imported ${validFileName} for ${validChanges.length} shop(s).`,
      shopIds: validChanges.map(change => change.shopId),
      shopNames: validChanges.map(change => change.shopName),
      metadata: { importId: validImportId, month: validMonth, recordCount: validChanges.length },
    });
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: mutationError("register the Excel import", error) };
  }
}

export async function handleUndoLatestImport() {
  try {
    await requireEditor();
    const snapshot = await getDocs(query(collection(db, "imports"), where("status", "==", "active"), orderBy("createdAt", "desc"), limit(1)));
    const importDocument = snapshot.docs[0];
    if (!importDocument) throw new Error("NO_IMPORT");
    const data = importDocument.data();
    const changeSnapshot = await getDocs(collection(db, "imports", importDocument.id, "changes"));
    const changes = z.array(importChangeSchema).min(1).max(150).parse(changeSnapshot.docs.map(document => document.data())) as Array<z.infer<typeof importChangeSchema>>;
    const currentShops = await Promise.all(changes.map(change => getDocs(query(collection(db, "shops"), where(documentId(), "==", change.shopId), limit(1)))));
    const changedAfterImport = changes.some((change, index) => {
      const currentDocument = currentShops[index].docs[0];
      if (!currentDocument) return true;
      const current = parseFirestoreDocument(shopSchema, currentDocument.id, currentDocument.data());
      return JSON.stringify(stableValue(toFirestoreData(current))) !== JSON.stringify(stableValue(toFirestoreData(change.importedShop)));
    });
    if (changedAfterImport) throw new Error("CHANGED_AFTER_IMPORT");
    const batch = writeBatch(db);
    changes.forEach(change => {
      const shopRef = doc(db, "shops", change.shopId);
      batch.delete(doc(db, "shops", change.shopId, "performance", change.performanceId));
      if (change.previousShop) {
        const { id: _id, ...previousData } = change.previousShop;
        batch.set(shopRef, toFirestoreData(previousData));
      } else {
        batch.delete(shopRef);
      }
    });
    batch.update(importDocument.ref, { status: "undone", undoneAt: new Date().toISOString(), undoneBy: await getCurrentActor() });
    await batch.commit();
    invalidateShopData();
    await recordActivity({
      action: "excel_import_undone",
      summary: `Undid import ${String(data.fileName ?? importDocument.id)}.`,
      shopIds: changes.map(change => change.shopId),
      shopNames: changes.map(change => change.shopName),
      metadata: { importId: importDocument.id, month: String(data.month ?? "") },
    });
    return { success: true as const, fileName: String(data.fileName ?? "Excel import") };
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "There is no active import to undo." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "The latest import cannot be undone because one or more affected shops changed afterward." };
    return { success: false as const, error: mutationError("undo the latest Excel import", error) };
  }
}

async function fetchPerformanceMonth(shopId: string, month: string) {
  const snapshot = await getDocs(query(
    collection(db, "shops", shopId, "performance"),
    where("date", ">=", `${month}-01`),
    where("date", "<=", `${month}-31`),
    orderBy("date", "desc"),
    limit(50),
  ));
  return snapshot.docs.flatMap(document => {
    const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    return parsed.success ? [parsed.data as unknown as PerformanceData] : [];
  });
}

function performanceSummary(shop: Shop, entries: PerformanceData[]) {
  const active = getOverviewPerformanceData(entries);
  const report = active.at(-1);
  const targets = report?.targets ?? shop.monthlyData?.[report?.date.slice(0, 7) ?? ""]?.targets ?? shop.monthlyTargets;
  if (!report || !targets) return { achievement: null, revenue: null, forecast: null, isFinal: false };
  const monthData = shop.monthlyData?.[report.date.slice(0, 7)];
  const settings = monthData?.metricSettings ?? shop.metricSettings;
  const metrics = getShopMetrics({ ...shop, metricSettings: settings, metricOrder: monthData?.metricOrder ?? shop.metricOrder }, targets);
  const actuals = getPerformanceShopActuals(active, metrics);
  const achievement = calculateTotalAchievement(actuals, targets, settings);
  const isFinal = report.reportType === "completedMonth";
  const reportedDate = parseISO(report.asOfDate ?? report.date);
  const forecast = isFinal ? null : achievement / Math.max(reportedDate.getDate(), 1) * getDaysInMonth(reportedDate);
  return { achievement, revenue: report.revenue ?? monthData?.collection ?? 0, forecast, isFinal };
}

export async function fetchDashboardMonths() {
  await getCurrentActor();
  const shops = await getDocs(collection(db, "shops"));
  const months = new Set<string>();
  shops.docs.forEach(document => Object.keys(document.data().monthlyData ?? {}).forEach(month => months.add(month)));
  if (!months.size) months.add(format(new Date(), "yyyy-MM"));
  return [...months].sort().reverse();
}

export async function fetchDashboardPage(input: { month: string; search?: string; pageSize: number; cursor?: DashboardCursor | null; sortDirection?: "asc" | "desc" }) {
  await getCurrentActor();
  const value = dashboardPageSchema.parse(input);
  const baseConstraints = [orderBy("name", value.sortDirection), orderBy(documentId(), value.sortDirection)];
  const searchConstraints = value.search
    ? value.sortDirection === "desc"
      ? [startAt(`${value.search}\uf8ff`), endAt(value.search)]
      : [startAt(value.search), endAt(`${value.search}\uf8ff`)]
    : [];
  const pageSearchConstraints = value.search
    ? value.cursor ? [endAt(value.sortDirection === "desc" ? value.search : `${value.search}\uf8ff`)] : searchConstraints
    : [];
  const filteredQuery = query(collection(db, "shops"), ...baseConstraints, ...searchConstraints);
  const [count, snapshot] = await Promise.all([
    getCountFromServer(filteredQuery),
    getDocs(query(collection(db, "shops"), ...baseConstraints, ...(value.cursor ? [startAfter(value.cursor.name, value.cursor.id)] : []), ...pageSearchConstraints, limit(value.pageSize + 1))),
  ]);
  const hasMore = snapshot.docs.length > value.pageSize;
  const documents = snapshot.docs.slice(0, value.pageSize);
  const previousMonth = format(subMonths(parseISO(`${value.month}-01`), 1), "yyyy-MM");
  const rows = await Promise.all(documents.map(async document => {
    const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
    if (!shop) return null;
    const [currentEntries, previousEntries] = await Promise.all([
      fetchPerformanceMonth(shop.id, value.month),
      fetchPerformanceMonth(shop.id, previousMonth),
    ]);
    const current = performanceSummary(shop, currentEntries);
    const previous = performanceSummary(shop, previousEntries);
    return {
      shop,
      revenue: current.revenue ?? 0,
      totalAchievement: current.achievement ?? 0,
      forecastAchievement: current.forecast,
      isFinal: current.isFinal,
      hasData: current.achievement !== null,
      previousAchievement: previous.achievement,
      previousRevenue: previous.revenue,
    } satisfies DashboardRow;
  }));
  const last = documents.at(-1);
  return {
    rows: rows.filter((row): row is DashboardRow => Boolean(row)),
    total: count.data().count,
    nextCursor: hasMore && last ? { name: String(last.data().name), id: last.id } : null,
  };
}
