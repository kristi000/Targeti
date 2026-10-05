"use server";

import { z } from "zod";
import { collection, doc, documentId, getDoc, getDocs, orderBy, query, runTransaction, where } from "@/lib/firebase-admin";
import { getCurrentActor, requireAdmin, requireEditorForShops, requireShopAccess } from "@/lib/access";
import { calculateDailyClosing, getDailyClosingMetricConfig } from "@/lib/daily-closing";
import { closingMonthSchema, monthlyDebtsInputSchema, monthlyUnsubscribesInputSchema, type MonthlyCellSummary, type MonthlyClosingSummary, type MonthlyDebtsPage, type MonthlyUnsubscribesPage } from "@/lib/monthly-closing";
import { attendanceDaySchema, attendanceMonthConfigSchema, dailyClosingInputSchema, dailyClosingSchema, debtMutationSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { type DailyClosing, type PerformanceMetric, type Shop } from "@/lib/types";
import { createActivity, mutationError, omitId, recordActivity, toFirestoreData } from "@/app/actions/shared";
import { adminDb as db } from "@/lib/firebase-admin";
import { requireRestrictedAccess } from "@/lib/restricted-access";

const dailyClosingSaveSchema = dailyClosingInputSchema.extend({ expectedUpdatedAt: z.string().datetime().nullable() });
type DailyClosingInput = z.infer<typeof dailyClosingSaveSchema>;

function parseDailyClosingDocument(id: string, value: unknown): DailyClosing | null {
  const parsed = dailyClosingSchema.safeParse({ id, ...(value as Record<string, unknown>) });
  if (parsed.success) return parsed.data as unknown as DailyClosing;
  console.error(`Ignoring invalid daily closing ${id}:`, parsed.error.flatten());
  return null;
}

async function getClosingShop(shopId: string) {
  const snapshot = await getDoc(doc(db, "shops", shopId));
  if (!snapshot.exists) throw new Error("SHOP_NOT_FOUND");
  const parsed = shopSchema.safeParse({ id: snapshot.id, ...snapshot.data() });
  if (!parsed.success) throw new Error("INVALID_SHOP");
  return parsed.data as unknown as Shop;
}

async function saveDailyClosing(input: DailyClosingInput, status: "draft" | "finalized") {
  const value = dailyClosingSaveSchema.parse(input);
  await requireEditorForShops([value.shopId]);
  const reference = doc(db, "shops", value.shopId, "dailyClosings", value.date);
  const shop = await getClosingShop(value.shopId);
  const { metrics, metricSettings, targets } = getDailyClosingMetricConfig(shop, value.date);
  const activities = Object.fromEntries(
    metrics.map(metric => [metric, value.activities[metric] ?? 0]),
  ) as Record<PerformanceMetric, number>;
  const unsubscribeEntries = value.unsubscribeEntries ?? [];
  const adjustments = {
    ...value.adjustments,
    unsubscribe: unsubscribeEntries.reduce((total, entry) => total + entry.amount, 0),
  };
  const calculation = calculateDailyClosing({
    cashCounts: value.cashCounts,
    exchangeRate: value.exchangeRate,
    adjustments,
    debts: value.debts,
    activities,
    metrics,
    metricSettings,
    targets,
  });
  const now = new Date().toISOString();
  const actor = await getCurrentActor();
  const activity = await createActivity({
    action: status === "finalized" ? "daily_closing_finalized" : "daily_closing_saved",
    summary: `${status === "finalized" ? "Finalized" : "Saved"} the daily closing for ${shop.name} on ${value.date}.`,
    shopIds: [shop.id],
    shopNames: [shop.name],
    metadata: { date: value.date, status, difference: calculation.totals.difference },
  }, actor);
  let closing: DailyClosing | null = null;
  await runTransaction(db, async transaction => {
    const existingSnapshot = await transaction.get(reference);
    const attendanceRef = doc(db, "shops", value.shopId, "attendanceDays", value.date);
    const attendanceSnapshot = status === "finalized" ? await transaction.get(attendanceRef) : null;
    const attendance = attendanceSnapshot?.exists ? attendanceDaySchema.parse(attendanceSnapshot.data()) : null;
    const attendanceMonthRef = doc(db, "shops", value.shopId, "attendanceMonths", value.date.slice(0, 7));
    const attendanceMonthSnapshot = status === "finalized" ? await transaction.get(attendanceMonthRef) : null;
    const attendanceMonth = attendanceMonthSnapshot?.exists ? attendanceMonthConfigSchema.parse(attendanceMonthSnapshot.data()) : null;
    const existing = existingSnapshot.exists ? parseDailyClosingDocument(existingSnapshot.id, existingSnapshot.data()) : null;
    if (existing?.status === "finalized") throw new Error("CLOSING_FINALIZED");
    if ((existing?.updatedAt ?? null) !== value.expectedUpdatedAt) throw new Error("CLOSING_CONFLICT");
    const existingCell = existing?.cell ?? { amount: 0, note: "" };
    if (actor.role !== "admin" && value.cell.note !== existingCell.note) {
      throw new Error("ADMIN_REQUIRED");
    }
    closing = dailyClosingSchema.parse({
      date: value.date,
      status,
      ...(status === "finalized" && attendance ? { attendance: attendance.entries } : {}),
      cashCounts: value.cashCounts,
      exchangeRate: value.exchangeRate,
      cell: value.cell,
      adjustments,
      debts: value.debts.map(debtValue => {
        const debt = { ...debtValue };
        delete debt.paidAt;
        const paidAt = existing?.debts.find(entry => entry.id === debt.id)?.paidAt;
        return { ...debt, ...(paidAt ? { paidAt } : {}) };
      }),
      unsubscribeEntries,
      activities,
      metricWeights: calculation.metricWeights,
      metricTargets: targets,
      totals: calculation.totals,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(status === "finalized" ? { finalizedAt: now, finalizedBy: actor.id } : {}),
    }) as unknown as DailyClosing;
    transaction.set(reference, toFirestoreData(closing));
    if (attendance) transaction.set(attendanceRef, { ...attendance, updatedAt: now, updatedBy: actor.id });
    if (attendanceMonth) transaction.set(attendanceMonthRef, { ...attendanceMonth, revision: attendanceMonth.revision + 1 });
    transaction.set(activity.reference, activity.data);
  });
  if (!closing) throw new Error("CLOSING_SAVE_FAILED");
  return closing as DailyClosing;
}

export async function fetchDailyClosing(shopId: string, date: string): Promise<DailyClosing | null> {
  const value = dailyClosingInputSchema.pick({ shopId: true, date: true }).parse({ shopId, date });
  await requireShopAccess(value.shopId);
  const snapshot = await getDoc(doc(db, "shops", value.shopId, "dailyClosings", value.date));
  return snapshot.exists ? parseDailyClosingDocument(snapshot.id, snapshot.data()) : null;
}

async function loadMonthlyClosings(shopId: string, month: string) {
  const validShopId = shopIdSchema.parse(shopId);
  const validMonth = closingMonthSchema.parse(month);
  const snapshot = await getDocs(query(
    collection(db, "shops", validShopId, "dailyClosings"),
    where(documentId(), ">=", `${validMonth}-01`),
    where(documentId(), "<=", `${validMonth}-31`),
    orderBy(documentId()),
  ));
  return snapshot.docs.map(document => ({ date: document.id, data: document.data() }));
}

export async function fetchMonthlyDebts(shopId: string, input: z.infer<typeof monthlyDebtsInputSchema>): Promise<
  | { success: true; data: MonthlyDebtsPage }
  | { success: false; error: "invalidData" | "invalidRequest" | "sessionExpired" | "loadFailed"; date?: string }
> {
  try {
  await requireRestrictedAccess();
  await requireShopAccess(shopId);
  const value = monthlyDebtsInputSchema.parse(input);
  const closings = await loadMonthlyClosings(shopId, value.month);
  const debts: MonthlyDebtsPage["rows"] = [];
  for (const { date, data } of closings) {
    // Reporting reads only the fields it needs; unrelated legacy fields must not block debts.
    const result = dailyClosingSchema.pick({ debts: true, status: true, updatedAt: true }).strip().safeParse(data);
    if (!result.success) {
      console.error("Invalid monthly debt data", { date, issues: result.error.issues.map(issue => ({ path: issue.path, code: issue.code })) });
      return { success: false, error: "invalidData", date };
    }
    debts.push(...result.data.debts.map(debt => ({
      id: `${date}:${debt.id}`, debtId: debt.id, date, description: debt.description, amount: debt.amount,
      ...(debt.paidAt ? { paidAt: debt.paidAt } : {}), finalized: result.data.status === "finalized", updatedAt: result.data.updatedAt,
    })));
  }
  const search = value.search.toLowerCase();
  const filtered = debts.filter(debt => debt.description.toLowerCase().includes(search)
    && (value.status === "all" || (value.status === "paid" ? !!debt.paidAt : !debt.paidAt)));
  const start = value.pageIndex * value.pageSize;
  return { success: true, data: {
    rows: filtered.slice(start, start + value.pageSize),
    rowCount: filtered.length,
    totalCount: debts.length,
    totalAmount: debts.reduce((sum, debt) => sum + debt.amount, 0),
    unpaidAmount: debts.reduce((sum, debt) => sum + (debt.paidAt ? 0 : debt.amount), 0),
  } };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return { success: false, error: "sessionExpired" };
    if (error instanceof z.ZodError) return { success: false, error: "invalidRequest" };
    console.error("Failed to load monthly debts:", error);
    return { success: false, error: "loadFailed" };
  }
}

export async function fetchMonthlyUnsubscribes(shopId: string, input: z.infer<typeof monthlyUnsubscribesInputSchema>): Promise<
  | { success: true; data: MonthlyUnsubscribesPage }
  | { success: false; error: "invalidData" | "invalidRequest" | "sessionExpired" | "loadFailed"; date?: string }
> {
  try {
    await requireRestrictedAccess();
    await requireShopAccess(shopId);
    const value = monthlyUnsubscribesInputSchema.parse(input);
    const closings = await loadMonthlyClosings(shopId, value.month);
    const unsubscribes: MonthlyUnsubscribesPage["rows"] = [];

    for (const { date, data } of closings) {
      // Include the legacy aggregate when a report predates detailed unsubscribe entries.
      const result = dailyClosingSchema.pick({ adjustments: true, unsubscribeEntries: true }).strip().safeParse(data);
      if (!result.success) {
        console.error("Invalid monthly unsubscribe data", { date, issues: result.error.issues.map(issue => ({ path: issue.path, code: issue.code })) });
        return { success: false, error: "invalidData", date };
      }
      const entries = result.data.unsubscribeEntries.length
        ? result.data.unsubscribeEntries
        : result.data.adjustments.unsubscribe > 0
          ? [{ id: "legacy-unsubscribe", invoice: "Legacy entry", msisdn: "-", amount: result.data.adjustments.unsubscribe }]
          : [];
      unsubscribes.push(...entries.map(entry => ({
        id: `${date}:${entry.id}`,
        date,
        invoice: entry.invoice,
        msisdn: entry.msisdn,
        amount: entry.amount,
      })));
    }

    const search = value.search.toLowerCase();
    const filtered = unsubscribes.filter(entry => [entry.date, entry.invoice, entry.msisdn]
      .some(field => field.toLowerCase().includes(search)));
    const start = value.pageIndex * value.pageSize;
    return { success: true, data: {
      rows: filtered.slice(start, start + value.pageSize),
      rowCount: filtered.length,
      totalCount: unsubscribes.length,
      totalAmount: unsubscribes.reduce((sum, entry) => sum + entry.amount, 0),
    } };
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return { success: false, error: "sessionExpired" };
    if (error instanceof z.ZodError) return { success: false, error: "invalidRequest" };
    console.error("Failed to load monthly unsubscribes:", error);
    return { success: false, error: "loadFailed" };
  }
}

export async function handleUpdateDebt(input: z.infer<typeof debtMutationSchema>) {
  try {
    await requireRestrictedAccess();
    const value = debtMutationSchema.parse(input);
    await requireEditorForShops([value.shopId]);
    const reference = doc(db, "shops", value.shopId, "dailyClosings", value.date);
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(reference);
      const closing = snapshot.exists ? parseDailyClosingDocument(snapshot.id, snapshot.data()) : null;
      if (!closing) throw new Error("DEBT_NOT_FOUND");
      if (closing.updatedAt !== value.expectedUpdatedAt) throw new Error("DEBT_CONFLICT");
      const debt = closing.debts.find(entry => entry.id === value.debtId);
      if (!debt) throw new Error("DEBT_NOT_FOUND");
      const change = value.change;
      if (change.kind === "edit" && closing.status === "finalized" && change.amount !== debt.amount) throw new Error("DEBT_FINALIZED");
      const now = new Date().toISOString();
      const updatedDebt = change.kind === "edit"
        ? { ...debt, description: change.description, amount: change.amount }
        : { ...debt, paidAt: change.paid ? debt.paidAt ?? now : undefined };
      const debts = closing.debts.map(entry => entry.id === debt.id ? updatedDebt : entry);
      const delta = updatedDebt.amount - debt.amount;
      transaction.update(reference, toFirestoreData({
        debts,
        updatedAt: now,
        totals: {
          ...closing.totals,
          debtTotal: closing.totals.debtTotal + delta,
          expectedCash: closing.totals.expectedCash - delta,
          difference: closing.totals.difference + delta,
        },
      }));
    });
    return { success: true as const };
  } catch (error) {
    const reasons: Record<string, "conflict" | "finalizedAmount" | "notFound" | "editForbidden" | "sessionExpired"> = {
      DEBT_CONFLICT: "conflict", DEBT_FINALIZED: "finalizedAmount", DEBT_NOT_FOUND: "notFound",
      EDITOR_REQUIRED: "editForbidden", UNAUTHENTICATED: "sessionExpired",
    };
    if (error instanceof Error && reasons[error.message]) return { success: false as const, error: reasons[error.message] };
    console.error("Failed to update debt:", error);
    return { success: false as const, error: "updateFailed" as const };
  }
}

export async function fetchMonthlyClosingSummary(shopId: string, month: string): Promise<MonthlyClosingSummary> {
  await requireRestrictedAccess();
  await requireShopAccess(shopId);
  const closings = await loadMonthlyClosings(shopId, month);
  const rows = closings.map(({ date, data }) => {
    // Fail visibly on invalid records instead of presenting incomplete monthly totals.
    const closing = dailyClosingInputSchema.pick({ adjustments: true, unsubscribeEntries: true }).strip().parse(data);
    const boss = closing.adjustments.boss;
    const invoice = closing.adjustments.invoice;
    const unsubscribe = closing.unsubscribeEntries.length
      ? closing.unsubscribeEntries.reduce((sum, entry) => sum + entry.amount, 0)
      : closing.adjustments.unsubscribe;
    return { date, boss, invoice, unsubscribe, net: boss + invoice - unsubscribe };
  });
  const totals = rows.reduce((sum, row) => ({
    boss: sum.boss + row.boss,
    invoice: sum.invoice + row.invoice,
    unsubscribe: sum.unsubscribe + row.unsubscribe,
    net: sum.net + row.net,
  }), { boss: 0, invoice: 0, unsubscribe: 0, net: 0 });
  return { rows, totals };
}

export async function fetchMonthlyCellSummary(shopId: string, month: string): Promise<MonthlyCellSummary> {
  await requireRestrictedAccess();
  await requireShopAccess(shopId);
  const closings = await loadMonthlyClosings(shopId, month);
  const rows = closings.map(({ date, data }) => {
    const closing = dailyClosingSchema.pick({ cell: true }).strip().parse(data);
    return { date, amount: closing.cell.amount, note: closing.cell.note };
  });
  return {
    rows,
    totalAmount: rows.reduce((total, row) => total + row.amount, 0),
  };
}

export async function handleSaveDailyClosing(input: DailyClosingInput) {
  try {
    return { success: true as const, data: await saveDailyClosing(input, "draft") };
  } catch (error) {
    if (error instanceof Error && error.message === "CLOSING_FINALIZED") {
      return { success: false as const, error: "This closing is finalized. An administrator must reopen it before changes can be saved." };
    }
    return { success: false as const, error: mutationError("save the daily closing", error) };
  }
}

export async function handleFinalizeDailyClosing(input: DailyClosingInput) {
  try {
    return { success: true as const, data: await saveDailyClosing(input, "finalized") };
  } catch (error) {
    if (error instanceof Error && error.message === "CLOSING_FINALIZED") {
      return { success: false as const, error: "This closing has already been finalized." };
    }
    return { success: false as const, error: mutationError("finalize the daily closing", error) };
  }
}

export async function handleReopenDailyClosing(shopId: string, date: string) {
  try {
    await requireAdmin();
    const value = dailyClosingInputSchema.pick({ shopId: true, date: true }).parse({ shopId, date });
    const reference = doc(db, "shops", value.shopId, "dailyClosings", value.date);
    const shop = await getClosingShop(value.shopId);
    const reopened = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists ? parseDailyClosingDocument(snapshot.id, snapshot.data()) : null;
      if (!existing) throw new Error("CLOSING_NOT_FOUND");
      if (existing.status !== "finalized") return existing;
      const updated = dailyClosingSchema.parse({
        ...existing,
        status: "draft",
        updatedAt: new Date().toISOString(),
        finalizedAt: undefined,
        finalizedBy: undefined,
      }) as unknown as DailyClosing;
      const documentData = omitId(updated);
      transaction.set(reference, toFirestoreData(documentData));
      return updated;
    });
    await recordActivity({
      action: "daily_closing_reopened",
      summary: `Reopened the daily closing for ${shop.name} on ${value.date}.`,
      shopIds: [shop.id],
      shopNames: [shop.name],
      metadata: { date: value.date },
    });
    return { success: true as const, data: reopened };
  } catch (error) {
    if (error instanceof Error && error.message === "CLOSING_NOT_FOUND") return { success: false as const, error: "Daily closing not found." };
    return { success: false as const, error: mutationError("reopen the daily closing", error) };
  }
}
