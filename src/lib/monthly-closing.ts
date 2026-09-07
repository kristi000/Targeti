import { z } from "zod";

export const closingMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a month in YYYY-MM format");

export type MonthlyClosingAmounts = {
  boss: number;
  invoice: number;
  unsubscribe: number;
  debt: number;
  net: number;
};

export type MonthlyClosingRow = MonthlyClosingAmounts & { date: string };

export type MonthlyClosingSummary = {
  rows: MonthlyClosingRow[];
  totals: MonthlyClosingAmounts;
};

export const monthlyClosingQueryKey = (shopId: string, month: string) => ["monthly-closing", shopId, month] as const;

export type MonthlyCellRow = {
  date: string;
  amount: number;
  note: string;
};

export type MonthlyCellSummary = {
  rows: MonthlyCellRow[];
  totalAmount: number;
};

export const monthlyCellQueryKey = (shopId: string, month: string) => ["monthly-cell", shopId, month] as const;

export const monthlyDebtsInputSchema = z.object({
  month: closingMonthSchema,
  search: z.string().trim().max(200),
  status: z.enum(["all", "unpaid", "paid"]).default("all"),
  pageIndex: z.number().int().min(0).max(3100),
  groupPageIndex: z.number().int().min(0).max(3100),
  pageSize: z.literal(20),
});

export type MonthlyDebtRow = { id: string; debtId: string; date: string; description: string; amount: number; paidAt?: string; finalized: boolean; updatedAt: string };
export type MonthlyDebtGroupRow = {
  id: string;
  description: string;
  count: number;
  totalAmount: number;
  unpaidAmount: number;
  paidAmount: number;
};
export type MonthlyDebtsPage = {
  rows: MonthlyDebtRow[];
  rowCount: number;
  groupRows: MonthlyDebtGroupRow[];
  groupRowCount: number;
  totalCount: number;
  totalAmount: number;
  unpaidAmount: number;
};
export const monthlyDebtsQueryKey = (shopId: string, month: string) => ["monthly-debts", shopId, month] as const;

export const monthlyUnsubscribesInputSchema = z.object({
  month: closingMonthSchema,
  search: z.string().trim().max(200),
  pageIndex: z.number().int().min(0).max(3100),
  pageSize: z.union([z.literal(20), z.literal(3100)]),
});

export type MonthlyUnsubscribeRow = {
  id: string;
  date: string;
  invoice: string;
  msisdn: string;
  amount: number;
};

export type MonthlyUnsubscribesPage = {
  rows: MonthlyUnsubscribeRow[];
  rowCount: number;
  totalCount: number;
  totalAmount: number;
};

export const monthlyUnsubscribesQueryKey = (shopId: string, month: string) => ["monthly-unsubscribes", shopId, month] as const;
