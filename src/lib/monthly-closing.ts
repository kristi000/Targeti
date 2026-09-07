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

export const monthlyDebtsInputSchema = z.object({
  month: closingMonthSchema,
  search: z.string().trim().max(200),
  status: z.enum(["all", "unpaid", "paid"]).default("all"),
  pageIndex: z.number().int().min(0).max(3100),
  pageSize: z.literal(20),
});

export type MonthlyDebtRow = { id: string; debtId: string; date: string; description: string; amount: number; paidAt?: string; finalized: boolean; updatedAt: string };
export type MonthlyDebtsPage = {
  rows: MonthlyDebtRow[];
  rowCount: number;
  totalCount: number;
  totalAmount: number;
  unpaidAmount: number;
};
export const monthlyDebtsQueryKey = (shopId: string, month: string) => ["monthly-debts", shopId, month] as const;
