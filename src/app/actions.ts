"use server";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteField,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "@/lib/firebase-admin";
import { format, getDaysInMonth, parseISO, subMonths } from "date-fns";
import { z } from "zod";

import { adminDb as db } from "@/lib/firebase-admin";
import { getCurrentActor, requireAdmin, requireEditor } from "@/lib/access";
import { createManagedUser, listManagedUsers, managedRoleSchema, setManagedUserRole, usernameSchema } from "@/lib/local-auth";
import { getMetricWeight } from "@/lib/data";
import { calculateTotalAchievement } from "@/lib/utils";
import { getEqualRepresentativeTargets } from "@/lib/representative-targets";
import {
  bonusSnapshotSchema,
  activityEventSchema,
  newShopSchema,
  performanceDataListSchema,
  performanceDataSchema,
  metricKeySchema,
  monthSchema,
  newSupervisorSchema,
  shopIdSchema,
  shopSchema,
  supervisorIdSchema,
  supervisorSchema,
  targetSchema,
} from "@/lib/persistence-schemas";
import { getInitialTargets, getOverviewPerformanceData, getPerformanceShopActuals, getQuarterKey, getShopMetrics, type ActivityEvent, type BonusSnapshot, type MetricSettings, type PerformanceData, type PerformanceMetric, type Shop, type Supervisor, type Target } from "@/lib/types";

export type ShopData = {
  shops: Shop[];
  supervisors: Supervisor[];
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

export async function fetchBonusSnapshot(shopId: string, month: string): Promise<BonusSnapshot | null> {
  await getCurrentActor();
  const validShopId = shopIdSchema.parse(shopId);
  const validMonth = monthSchema.parse(month);
  const snapshot = await doc(db, "shops", validShopId, "bonusSnapshots", validMonth).get();
  if (!snapshot.exists) return null;
  const result = bonusSnapshotSchema.safeParse(snapshot.data());
  if (result.success) return result.data as BonusSnapshot;
  console.error(`Ignoring invalid bonus snapshot ${snapshot.ref.path}:`, result.error.flatten());
  return null;
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
    const actor = await requireEditor();
    let validShop = shopSchema.parse(shop) as Shop;
    if (actor.role !== "admin") {
      const currentDocument = (await getDocs(query(collection(db, "shops"), where(documentId(), "==", validShop.id), limit(1)))).docs[0];
      const currentShop = currentDocument ? parseFirestoreDocument(shopSchema, currentDocument.id, currentDocument.data()) as Shop | null : null;
      validShop = { ...validShop, supervisorId: currentShop?.supervisorId };
    }
    const { id, ...shopData } = validShop;
    await updateDoc(doc(db, "shops", id), toFirestoreData(shopData));
    await recordActivity({ action: "shop_edited", summary: `Edited shop ${validShop.name}.`, shopIds: [id], shopNames: [validShop.name] });
    invalidateShopData();
    return { success: true as const, data: validShop };
  } catch (error) {
    return { success: false as const, error: mutationError("update the shop", error) };
  }
}

const representativeDeletionSchema = z.object({
  month: monthSchema,
  representatives: z.array(z.object({
    shopId: shopIdSchema,
    representativeId: shopIdSchema,
  }).strict()).min(1).max(500),
}).strict();

export async function handleDeleteRepresentatives(month: string, representatives: Array<{ shopId: string; representativeId: string }>) {
  try {
    await requireEditor();
    const input = representativeDeletionSchema.parse({ month, representatives });
    const representativeIdsByShop = new Map<string, Set<string>>();
    input.representatives.forEach(({ shopId, representativeId }) => {
      const ids = representativeIdsByShop.get(shopId) ?? new Set<string>();
      ids.add(representativeId);
      representativeIdsByShop.set(shopId, ids);
    });

    const snapshot = await getDocs(collection(db, "shops"));
    const selectedDocuments = snapshot.docs.filter(document => representativeIdsByShop.has(document.id));
    if (selectedDocuments.length !== representativeIdsByShop.size) throw new Error("SHOP_NOT_FOUND");

    const updatedShops: Shop[] = [];
    let deletedCount = 0;
    selectedDocuments.forEach(document => {
      const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
      if (!shop) return;
      const selectedIds = representativeIdsByShop.get(shop.id)!;
      const monthData = shop.monthlyData?.[input.month];
      const currentRepresentatives = monthData?.representatives ?? shop.salesRepresentatives ?? [];
      const remainingRepresentatives = currentRepresentatives.filter(representative => !selectedIds.has(representative.id));
      deletedCount += currentRepresentatives.length - remainingRepresentatives.length;

      if (monthData) {
        const metrics = getShopMetrics({
          ...shop,
          metricSettings: monthData.metricSettings ?? shop.metricSettings,
          metricOrder: monthData.metricOrder ?? shop.metricOrder,
        }, monthData.targets);
        const sharedTargets = getEqualRepresentativeTargets(monthData.targets, metrics, remainingRepresentatives.length);
        updatedShops.push({
          ...shop,
          monthlyData: {
            ...shop.monthlyData,
            [input.month]: {
              ...monthData,
              representatives: remainingRepresentatives,
              representativeTargets: Object.fromEntries(remainingRepresentatives.map(representative => [representative.id, sharedTargets])),
            },
          },
        });
      } else {
        updatedShops.push({ ...shop, salesRepresentatives: remainingRepresentatives });
      }
    });

    if (!deletedCount) throw new Error("REPRESENTATIVES_NOT_FOUND");
    const batch = writeBatch(db);
    updatedShops.forEach(shop => {
      const { id, ...shopData } = shopSchema.parse(shop) as Shop;
      batch.set(doc(db, "shops", id), toFirestoreData(shopData));
    });
    await batch.commit();
    await recordActivity({
      action: "representatives_deleted",
      summary: `Deleted ${deletedCount} representative(s) from ${updatedShops.length} shop(s) for ${input.month}.`,
      shopIds: updatedShops.map(shop => shop.id),
      shopNames: updatedShops.map(shop => shop.name),
      metadata: { month: input.month, representativeCount: deletedCount, shopCount: updatedShops.length },
    });
    invalidateShopData();
    return { success: true as const, count: deletedCount, shops: updatedShops.length };
  } catch (error) {
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more shops no longer exist." };
    if (error instanceof Error && error.message === "REPRESENTATIVES_NOT_FOUND") return { success: false as const, error: "The selected representatives no longer exist in this reporting month." };
    return { success: false as const, error: mutationError("delete the selected representatives", error) };
  }
}

async function supervisorNameExists(name: string, excludedId?: string) {
  const normalizedName = name.toLocaleLowerCase();
  const snapshot = await getDocs(collection(db, "supervisors"));
  return snapshot.docs.some(document => document.id !== excludedId && String(document.data().name ?? "").trim().toLocaleLowerCase() === normalizedName);
}

export async function handleAddSupervisor(name: string) {
  try {
    await requireAdmin();
    const input = newSupervisorSchema.parse({ name });
    if (await supervisorNameExists(input.name)) throw new Error("DUPLICATE_SUPERVISOR");
    const document = await addDoc(collection(db, "supervisors"), input);
    const supervisor = { id: document.id, name: input.name } satisfies Supervisor;
    await recordActivity({ action: "supervisor_created", summary: `Created supervisor ${supervisor.name}.`, shopIds: [], shopNames: [], metadata: { supervisorId: supervisor.id } });
    invalidateShopData();
    return { success: true as const, data: supervisor };
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_SUPERVISOR") return { success: false as const, error: "A supervisor with this name already exists." };
    return { success: false as const, error: mutationError("add the supervisor", error) };
  }
}

export async function handleUpdateSupervisor(supervisor: Supervisor) {
  try {
    await requireAdmin();
    const validSupervisor = supervisorSchema.parse(supervisor) as Supervisor;
    if (await supervisorNameExists(validSupervisor.name, validSupervisor.id)) throw new Error("DUPLICATE_SUPERVISOR");
    await updateDoc(doc(db, "supervisors", validSupervisor.id), { name: validSupervisor.name });
    await recordActivity({ action: "supervisor_edited", summary: `Renamed supervisor to ${validSupervisor.name}.`, shopIds: [], shopNames: [], metadata: { supervisorId: validSupervisor.id } });
    invalidateShopData();
    return { success: true as const, data: validSupervisor };
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_SUPERVISOR") return { success: false as const, error: "A supervisor with this name already exists." };
    return { success: false as const, error: mutationError("update the supervisor", error) };
  }
}

export async function handleAssignSupervisor(supervisorId: string, shopIds: string[]) {
  try {
    await requireAdmin();
    const validSupervisorId = supervisorIdSchema.parse(supervisorId);
    const validShopIds = z.array(shopIdSchema).max(500).parse(shopIds);
    const [supervisorDocument, shopsSnapshot] = await Promise.all([
      getDocs(query(collection(db, "supervisors"), where(documentId(), "==", validSupervisorId), limit(1))),
      getDocs(collection(db, "shops")),
    ]);
    if (!supervisorDocument.docs[0]) throw new Error("SUPERVISOR_NOT_FOUND");
    const selectedIds = new Set(validShopIds);
    if (shopsSnapshot.docs.filter(document => selectedIds.has(document.id)).length !== selectedIds.size) throw new Error("SHOP_NOT_FOUND");
    const changedDocuments = shopsSnapshot.docs.filter(document => selectedIds.has(document.id) || document.data().supervisorId === validSupervisorId);
    for (let start = 0; start < changedDocuments.length; start += 450) {
      const batch = writeBatch(db);
      changedDocuments.slice(start, start + 450).forEach(document => batch.update(document.ref, {
        supervisorId: selectedIds.has(document.id) ? validSupervisorId : deleteField(),
      }));
      await batch.commit();
    }
    const selectedShops = shopsSnapshot.docs.filter(document => selectedIds.has(document.id));
    const supervisorName = String(supervisorDocument.docs[0].data().name ?? validSupervisorId);
    await recordActivity({ action: "supervisor_assignments_changed", summary: `Assigned ${selectedShops.length} shop(s) to ${supervisorName}.`, shopIds: selectedShops.map(document => document.id), shopNames: selectedShops.map(document => String(document.data().name ?? document.id)), metadata: { supervisorId: validSupervisorId, shopCount: selectedShops.length } });
    invalidateShopData();
    return { success: true as const, count: selectedShops.length };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPERVISOR_NOT_FOUND") return { success: false as const, error: "The supervisor no longer exists." };
    if (error instanceof Error && error.message === "SHOP_NOT_FOUND") return { success: false as const, error: "One or more shops no longer exist." };
    return { success: false as const, error: mutationError("assign shops to the supervisor", error) };
  }
}

export async function handleDeleteSupervisor(supervisorId: string) {
  try {
    await requireAdmin();
    const validSupervisorId = supervisorIdSchema.parse(supervisorId);
    const [supervisorSnapshot, assignedShops] = await Promise.all([
      getDocs(query(collection(db, "supervisors"), where(documentId(), "==", validSupervisorId), limit(1))),
      getDocs(query(collection(db, "shops"), where("supervisorId", "==", validSupervisorId))),
    ]);
    const supervisorDocument = supervisorSnapshot.docs[0];
    if (!supervisorDocument) throw new Error("SUPERVISOR_NOT_FOUND");
    for (let start = 0; start < assignedShops.docs.length; start += 450) {
      const batch = writeBatch(db);
      assignedShops.docs.slice(start, start + 450).forEach(document => batch.update(document.ref, { supervisorId: deleteField() }));
      await batch.commit();
    }
    await supervisorDocument.ref.delete();
    const supervisorName = String(supervisorDocument.data().name ?? validSupervisorId);
    await recordActivity({ action: "supervisor_deleted", summary: `Deleted supervisor ${supervisorName} and unassigned ${assignedShops.size} shop(s).`, shopIds: assignedShops.docs.map(document => document.id), shopNames: assignedShops.docs.map(document => String(document.data().name ?? document.id)), metadata: { supervisorId: validSupervisorId, shopCount: assignedShops.size } });
    invalidateShopData();
    return { success: true as const };
  } catch (error) {
    if (error instanceof Error && error.message === "SUPERVISOR_NOT_FOUND") return { success: false as const, error: "The supervisor no longer exists." };
    return { success: false as const, error: mutationError("delete the supervisor", error) };
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
    const [shops, supervisors] = await Promise.all([
      getDocs(collection(db, "shops")),
      getDocs(collection(db, "supervisors")),
    ]);
    const references: DocumentReference[] = supervisors.docs.map(document => document.ref);
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

async function loadSupervisors(): Promise<Supervisor[]> {
  const snapshot = await getDocs(collection(db, "supervisors"));
  return snapshot.docs.flatMap(document => {
    const supervisor = parseFirestoreDocument(supervisorSchema, document.id, document.data());
    return supervisor ? [supervisor as Supervisor] : [];
  }).sort((left, right) => left.name.localeCompare(right.name));
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

async function fetchPerformanceDocuments(startDate: string, endDate: string) {
  try {
    const snapshot = await getDocs(query(
      collectionGroup(db, "performance"),
      where("date", ">=", startDate),
      where("date", "<=", endDate),
      orderBy("date", "asc"),
    ));
    return snapshot.docs;
  } catch (error) {
    console.warn("The optimized performance collection-group query is unavailable; using per-shop queries temporarily.", error);
    const shops = await getDocs(collection(db, "shops"));
    const snapshots = await Promise.all(shops.docs.map(shop => getDocs(
      collection(db, "shops", shop.id, "performance"),
    )));
    return snapshots
      .flatMap(snapshot => snapshot.docs)
      .filter(document => {
        const date = String(document.data().date ?? "");
        return date >= startDate && date <= endDate;
      })
      .sort((left, right) => String(left.data().date ?? "").localeCompare(String(right.data().date ?? "")));
  }
}

export async function fetchPerformanceDataForMonth(month: string): Promise<Record<string, PerformanceData[]>> {
  await getCurrentActor();
  const validMonth = monthSchema.parse(month);
  const documents = await fetchPerformanceDocuments(`${validMonth}-01`, `${validMonth}-31`);
  const performanceData: Record<string, PerformanceData[]> = {};
  documents.forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    if (!shopId) return;
    const result = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (!result.success) {
      console.error(`Ignoring invalid performance document ${document.ref.path}:`, result.error.flatten());
      return;
    }
    (performanceData[shopId] ??= []).push(result.data as unknown as PerformanceData);
  });
  return performanceData;
}

const loadShopData = unstable_cache(async (): Promise<ShopData> => {
  const [shops, supervisors] = await Promise.all([
    loadShops(),
    loadSupervisors(),
  ]);

  return {
    shops,
    supervisors,
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

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  lastSignInAt: string | null;
};

export async function fetchAuthUsers(): Promise<AuthUser[]> {
  await requireAdmin();
  const users = await listManagedUsers();
  return [
    { id: "local-admin", username: "admin", name: "Administrator", role: "admin", lastSignInAt: null },
    ...users.map(user => ({ id: user.id, username: user.username, name: user.name, role: user.role, lastSignInAt: user.lastSignInAt })),
  ];
}

const createAuthUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(120),
  password: z.string().min(2).max(128),
  role: managedRoleSchema,
}).strict();

export async function handleCreateAuthUser(input: { username: string; name: string; password: string; role: "editor" | "viewer" }) {
  try {
    await requireAdmin();
    const user = await createManagedUser(createAuthUserSchema.parse(input));
    await recordActivity({ action: "user_created", summary: `Created ${user.role} profile ${user.username}.`, shopIds: [], shopNames: [], metadata: { userId: user.id, role: user.role } });
    return { success: true as const, user: { id: user.id, username: user.username, name: user.name, role: user.role, lastSignInAt: user.lastSignInAt } satisfies AuthUser };
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") return { success: false as const, error: "That username is already in use." };
    return { success: false as const, error: mutationError("create the user profile", error) };
  }
}

export async function handleSetUserRole(userId: string, role: "editor" | "viewer") {
  try {
    await requireAdmin();
    const validUserId = z.string().uuid().parse(userId);
    const validRole = managedRoleSchema.parse(role);
    const user = await setManagedUserRole(validUserId, validRole);
    await recordActivity({ action: "user_role_changed", summary: `Changed ${user.username} to ${validRole}.`, shopIds: [], shopNames: [], metadata: { userId: validUserId, role: validRole } });
    return { success: true as const, role: validRole };
  } catch (error) {
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
export type DashboardSortKey = "shop" | "achievement" | "forecast" | "revenue";
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
  sortBy: z.enum(["shop", "achievement", "forecast", "revenue"]).default("shop"),
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

export type ImportHistoryItem = {
  id: string;
  fileName: string;
  month: string;
  createdAt: string;
  actorName: string;
  status: "active" | "undone" | "removed";
  recordCount: number;
  undoneAt?: string;
};

const importHistoryCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: shopIdSchema }).optional();

export async function fetchImportHistoryPage(cursor?: { createdAt: string; id: string }) {
  await getCurrentActor();
  const validCursor = importHistoryCursorSchema.parse(cursor);
  const constraints = [orderBy("createdAt", "desc"), orderBy(documentId(), "desc"), ...(validCursor ? [startAfter(validCursor.createdAt, validCursor.id)] : []), limit(21)];
  const snapshot = await getDocs(query(collection(db, "imports"), ...constraints));
  const hasMore = snapshot.docs.length > 20;
  const documents = snapshot.docs.slice(0, 20);
  const imports = documents.flatMap(document => {
    const data = document.data();
    const parsed = z.object({
      fileName: z.string().trim().min(1).max(255),
      month: monthSchema,
      createdAt: z.string().datetime({ offset: true }),
      actor: z.object({ name: z.string().trim().min(1).max(120) }).passthrough(),
      status: z.enum(["active", "undone", "removed"]),
      recordCount: z.number().int().nonnegative(),
      undoneAt: z.string().datetime({ offset: true }).optional(),
    }).safeParse(data);
    if (!parsed.success) return [];
    return [{
      id: document.id,
      fileName: parsed.data.fileName,
      month: parsed.data.month,
      createdAt: parsed.data.createdAt,
      actorName: parsed.data.actor.name,
      status: parsed.data.status,
      recordCount: parsed.data.recordCount,
      undoneAt: parsed.data.undoneAt,
    } satisfies ImportHistoryItem];
  });
  const last = documents.at(-1);
  return {
    imports,
    nextCursor: hasMore && last ? { createdAt: String(last.data().createdAt), id: last.id } : null,
  };
}

async function undoImport(importDocument: (Awaited<ReturnType<typeof getDocs>>)["docs"][number]) {
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
}

export async function handleUndoImport(importId: string) {
  try {
    await requireEditor();
    const validImportId = shopIdSchema.parse(importId);
    const snapshot = await getDocs(query(collection(db, "imports"), where("status", "==", "active"), orderBy("createdAt", "desc"), limit(1)));
    const importDocument = snapshot.docs[0];
    if (!importDocument) throw new Error("NO_IMPORT");
    if (importDocument.id !== validImportId) throw new Error("NEWER_IMPORT_EXISTS");
    return await undoImport(importDocument);
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "There is no active import to undo." };
    if (error instanceof Error && error.message === "NEWER_IMPORT_EXISTS") return { success: false as const, error: "Undo newer active imports first to preserve import order." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "The latest import cannot be undone because one or more affected shops changed afterward." };
    return { success: false as const, error: mutationError("undo the latest Excel import", error) };
  }
}

export async function handleRemoveImport(importId: string) {
  try {
    await requireEditor();
    const validImportId = shopIdSchema.parse(importId);
    const importSnapshot = await getDocs(query(collection(db, "imports"), where(documentId(), "==", validImportId), limit(1)));
    const importDocument = importSnapshot.docs[0];
    if (!importDocument || importDocument.data().status !== "active") throw new Error("NO_IMPORT");
    const data = importDocument.data();
    const month = monthSchema.parse(data.month);
    const changeSnapshot = await getDocs(collection(db, "imports", importDocument.id, "changes"));
    const changes = z.array(importChangeSchema).min(1).max(150).parse(changeSnapshot.docs.map(document => document.data())) as Array<z.infer<typeof importChangeSchema>>;

    const currentVersionChecks = await Promise.all(changes.map(async change => {
      const performance = await getDocs(collection(db, "shops", change.shopId, "performance"));
      const latest = performance.docs.flatMap(document => {
        const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
        return parsed.success && parsed.data.importId && parsed.data.date.startsWith(month) ? [parsed.data] : [];
      }).sort((left, right) => (right.importedAt ?? right.date).localeCompare(left.importedAt ?? left.date))[0];
      return latest?.importId === validImportId;
    }));
    const currentVersionCount = currentVersionChecks.filter(Boolean).length;

    if (currentVersionCount === changes.length) return await undoImport(importDocument);
    if (currentVersionCount > 0) throw new Error("PARTIALLY_CURRENT");

    const batch = writeBatch(db);
    changes.forEach(change => batch.delete(doc(db, "shops", change.shopId, "performance", change.performanceId)));
    batch.update(importDocument.ref, { status: "removed", removedAt: new Date().toISOString(), removedBy: await getCurrentActor() });
    await batch.commit();
    invalidateShopData();
    await recordActivity({
      action: "excel_import_removed",
      summary: `Removed stored import ${String(data.fileName ?? importDocument.id)}.`,
      shopIds: changes.map(change => change.shopId),
      shopNames: changes.map(change => change.shopName),
      metadata: { importId: importDocument.id, month, recordCount: changes.length },
    });
    return { success: true as const, fileName: String(data.fileName ?? "Excel import"), restoredShopData: false };
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "This import has already been removed or no longer exists." };
    if (error instanceof Error && error.message === "PARTIALLY_CURRENT") return { success: false as const, error: "This file is current for only some affected shops. Remove newer overlapping imports first." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "This import cannot be removed because one or more affected shops were edited afterward." };
    return { success: false as const, error: mutationError("remove the Excel import", error) };
  }
}

export async function handleUndoLatestImport() {
  try {
    await requireEditor();
    const snapshot = await getDocs(query(collection(db, "imports"), where("status", "==", "active"), orderBy("createdAt", "desc"), limit(1)));
    const importDocument = snapshot.docs[0];
    if (!importDocument) throw new Error("NO_IMPORT");
    return await undoImport(importDocument);
  } catch (error) {
    if (error instanceof Error && error.message === "NO_IMPORT") return { success: false as const, error: "There is no active import to undo." };
    if (error instanceof Error && error.message === "CHANGED_AFTER_IMPORT") return { success: false as const, error: "The latest import cannot be undone because one or more affected shops changed afterward." };
    return { success: false as const, error: mutationError("undo the latest Excel import", error) };
  }
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

export async function fetchDashboardPage(input: { month: string; search?: string; pageSize: number; cursor?: DashboardCursor | null; sortBy?: DashboardSortKey; sortDirection?: "asc" | "desc" }) {
  await getCurrentActor();
  const value = dashboardPageSchema.parse(input);
  const previousMonth = format(subMonths(parseISO(`${value.month}-01`), 1), "yyyy-MM");
  const [snapshot, supervisors, performanceDocuments] = await Promise.all([
    getDocs(query(collection(db, "shops"), orderBy("name", "asc"))),
    loadSupervisors(),
    fetchPerformanceDocuments(`${previousMonth}-01`, `${value.month}-31`),
  ]);
  const performanceByShopAndMonth = new Map<string, PerformanceData[]>();
  performanceDocuments.forEach(document => {
    const shopId = document.ref.parent.parent?.id;
    const parsed = performanceDataSchema.safeParse({ id: document.id, ...document.data() });
    if (!shopId || !parsed.success) return;
    const entry = parsed.data as unknown as PerformanceData;
    const key = `${shopId}:${entry.date.slice(0, 7)}`;
    const entries = performanceByShopAndMonth.get(key) ?? [];
    entries.push(entry);
    performanceByShopAndMonth.set(key, entries);
  });
  const normalizedSearch = value.search.toLocaleLowerCase();
  const matchingSupervisorIds = new Set(supervisors
    .filter(supervisor => supervisor.name.toLocaleLowerCase().includes(normalizedSearch))
    .map(supervisor => supervisor.id));
  const matchingDocuments = normalizedSearch
    ? snapshot.docs.filter(document => {
      const data = document.data();
      return String(data.name ?? "").toLocaleLowerCase().includes(normalizedSearch)
        || matchingSupervisorIds.has(String(data.supervisorId ?? ""));
    })
    : snapshot.docs;
  const rows = matchingDocuments.map(document => {
    const shop = parseFirestoreDocument(shopSchema, document.id, document.data()) as Shop | null;
    if (!shop) return null;
    const currentEntries = performanceByShopAndMonth.get(`${shop.id}:${value.month}`) ?? [];
    const previousEntries = performanceByShopAndMonth.get(`${shop.id}:${previousMonth}`) ?? [];
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
  }).filter((row): row is DashboardRow => Boolean(row));

  const direction = value.sortDirection === "asc" ? 1 : -1;
  const getSortValue = (row: DashboardRow): string | number | null => {
    if (value.sortBy === "shop") return row.shop.name;
    if (!row.hasData) return null;
    if (value.sortBy === "achievement") return row.totalAchievement;
    if (value.sortBy === "forecast") return row.forecastAchievement ?? (row.isFinal ? row.totalAchievement : null);
    return row.revenue;
  };
  rows.sort((left, right) => {
    const leftValue = getSortValue(left);
    const rightValue = getSortValue(right);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      const comparison = leftValue.localeCompare(rightValue);
      if (comparison) return comparison * direction;
    } else if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * direction;
    }
    return left.shop.name.localeCompare(right.shop.name) || left.shop.id.localeCompare(right.shop.id);
  });

  const cursorIndex = value.cursor ? rows.findIndex(row => row.shop.id === value.cursor?.id) : -1;
  const pageStart = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const pageRows = rows.slice(pageStart, pageStart + value.pageSize);
  const hasMore = pageStart + value.pageSize < rows.length;
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    total: rows.length,
    nextCursor: hasMore && last ? { name: last.shop.name, id: last.shop.id } : null,
  };
}
