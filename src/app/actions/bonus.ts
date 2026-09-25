"use server";

import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, startAfter } from "@/lib/firebase-admin";
import { z } from "zod";
import { requireEditorForShops, requireShopAccess } from "@/lib/access";
import { bonusSnapshotSchema, monthSchema, quarterSchema, quarterlyBonusSnapshotSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { type BonusSnapshot, type QuarterlyBonusSnapshot } from "@/lib/types";
import { calculateQuarterlyBonus, getQuarterMonths, getQuarterlyMonthFromSnapshot, QUARTERLY_CALCULATION_VERSION, QUARTERLY_PAYOUT_TABLE_VERSION } from "@/lib/quarterly-bonus";
import { mutationError, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";
import { requireRestrictedAccess } from "@/lib/restricted-access";
import { type BonusHistoryCursor, type BonusHistoryMonth, monthlyHistoryRecord, quarterlyHistoryRecord, quarterlyPayoutMonth } from "@/lib/bonus-history";

const historyCursorSchema = z.object({ month: monthSchema.optional(), quarter: quarterSchema.optional() }).strict().optional();

export async function fetchBonusHistoryPage(shopId: string, cursor?: BonusHistoryCursor): Promise<{ rows: BonusHistoryMonth[]; nextCursor: BonusHistoryCursor | null }> {
  await requireRestrictedAccess();
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  const validCursor = historyCursorSchema.parse(cursor);
  const [monthlyDocs, quarterlyDocs] = await Promise.all([
    getDocs(query(collection(db, "shops", validShopId, "bonusSnapshots"), orderBy("month", "desc"), ...(validCursor?.month ? [startAfter(validCursor.month)] : []), limit(21))),
    getDocs(query(collection(db, "shops", validShopId, "quarterlyBonusSnapshots"), orderBy("quarter", "desc"), ...(validCursor?.quarter ? [startAfter(validCursor.quarter)] : []), limit(21))),
  ]);
  const candidates = [
    ...monthlyDocs.docs.map(document => ({ kind: "monthly" as const, id: document.id, month: document.id, data: document.data() })),
    ...quarterlyDocs.docs.map(document => ({ kind: "quarterly" as const, id: document.id, month: quarterlyPayoutMonth(document.id), data: document.data() })),
  ].filter(item => item.month).sort((a, b) => b.month.localeCompare(a.month) || a.kind.localeCompare(b.kind));
  const selectedMonths = [...new Set(candidates.map(item => item.month))].slice(0, 20);
  const selected = candidates.filter(item => selectedMonths.includes(item.month));
  const rows = selectedMonths.map(month => {
    const monthly = selected.find(item => item.month === month && item.kind === "monthly");
    const quarterly = selected.find(item => item.month === month && item.kind === "quarterly");
    const parsedMonthly = monthly ? bonusSnapshotSchema.safeParse(monthly.data) : null;
    const parsedQuarterly = quarterly ? quarterlyBonusSnapshotSchema.safeParse(quarterly.data) : null;
    return {
      month,
      monthly: parsedMonthly?.success && parsedMonthly.data.month === monthly?.id ? monthlyHistoryRecord(parsedMonthly.data as BonusSnapshot) : null,
      quarterly: parsedQuarterly?.success && parsedQuarterly.data.quarter === quarterly?.id ? quarterlyHistoryRecord(parsedQuarterly.data as QuarterlyBonusSnapshot) : null,
    };
  }).filter(row => row.monthly || row.quarterly);
  const nextCursor = candidates.some(item => !selected.includes(item)) || monthlyDocs.size === 21 || quarterlyDocs.size === 21
    ? {
      month: selected.filter(item => item.kind === "monthly").at(-1)?.id ?? validCursor?.month,
      quarter: selected.filter(item => item.kind === "quarterly").at(-1)?.id ?? validCursor?.quarter,
    }
    : null;
  return { rows, nextCursor };
}

export async function saveBonusSnapshot(shopId: string, snapshot: BonusSnapshot) {
  try {
    await requireRestrictedAccess();
    await requireEditorForShops([shopId]);
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
  await requireRestrictedAccess();
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  const validMonth = monthSchema.parse(month);
  const snapshot = await getDoc(doc(db, "shops", validShopId, "bonusSnapshots", validMonth));
  if (!snapshot.exists) return null;
  const result = bonusSnapshotSchema.safeParse(snapshot.data());
  if (result.success) return result.data as BonusSnapshot;
  console.error(`Ignoring invalid bonus snapshot ${snapshot.ref.path}:`, result.error.flatten());
  return null;
}

export async function fetchQuarterlyBonusSnapshot(shopId: string, quarter: string): Promise<QuarterlyBonusSnapshot | null> {
  await requireRestrictedAccess();
  const validShopId = shopIdSchema.parse(shopId);
  await requireShopAccess(validShopId);
  const validQuarter = quarterSchema.parse(quarter);
  const snapshot = await getDoc(doc(db, "shops", validShopId, "quarterlyBonusSnapshots", validQuarter));
  if (!snapshot.exists) return null;
  const result = quarterlyBonusSnapshotSchema.safeParse(snapshot.data());
  if (result.success) return result.data as QuarterlyBonusSnapshot;
  console.error(`Ignoring invalid quarterly bonus snapshot ${snapshot.ref.path}:`, result.error.flatten());
  return null;
}

export async function saveQuarterlyBonusSnapshot(shopId: string, quarter: string) {
  try {
    await requireRestrictedAccess();
    await requireEditorForShops([shopId]);
    const validShopId = shopIdSchema.parse(shopId);
    const validQuarter = quarterSchema.parse(quarter);
    const months = getQuarterMonths(validQuarter);
    const ref = doc(db, "shops", validShopId, "quarterlyBonusSnapshots", validQuarter);
    const monthRefs = months.map(month => doc(db, "shops", validShopId, "bonusSnapshots", month));
    const snapshot = await runTransaction(db, async transaction => {
      const [existing, ...monthlyDocs] = await Promise.all([transaction.get(ref), ...monthRefs.map(monthRef => transaction.get(monthRef))]);
      if (existing.exists) throw new Error("ALREADY_FINALIZED");
      const monthlySnapshots = monthlyDocs.map(monthDoc => {
        const result = bonusSnapshotSchema.safeParse(monthDoc.data());
        if (!result.success) throw new Error("MONTHS_REQUIRED");
        return result.data as BonusSnapshot;
      });
      const nextSnapshot: QuarterlyBonusSnapshot = {
        quarter: validQuarter,
        finalizedAt: new Date().toISOString(),
        calculationVersion: QUARTERLY_CALCULATION_VERSION,
        payoutTableVersion: QUARTERLY_PAYOUT_TABLE_VERSION,
        monthlySources: monthlySnapshots.map(item => ({ month: item.month, finalizedAt: item.finalizedAt })),
        result: calculateQuarterlyBonus(validQuarter, monthlySnapshots.map(getQuarterlyMonthFromSnapshot)),
      };
      quarterlyBonusSnapshotSchema.parse(nextSnapshot);
      transaction.set(ref, toFirestoreData(nextSnapshot));
      return nextSnapshot;
    });
    return { success: true as const, data: snapshot };
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_FINALIZED") return { success: false as const, error: "This quarter has already been finalized." };
    if (error instanceof Error && error.message === "MONTHS_REQUIRED") return { success: false as const, error: "Finalize all three monthly payroll snapshots first." };
    return { success: false as const, error: mutationError("finalize the quarterly payroll snapshot", error) };
  }
}
