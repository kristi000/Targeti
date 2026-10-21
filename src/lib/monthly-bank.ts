import { z } from "zod";
import { attendanceMonthSchema, monthlyBankReconciliationSchema, monthlyBankValuesSchema, shopIdSchema } from "@/lib/persistence-schemas";

export const saveMonthlyBankReconciliationSchema = monthlyBankValuesSchema.extend({
  shopId: shopIdSchema,
  month: attendanceMonthSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export type MonthlyBankReconciliation = z.infer<typeof monthlyBankReconciliationSchema>;
export const monthlyBankQueryKey = (shopId: string, month: string) => ["monthly-bank", shopId, month] as const;

export function emptyMonthlyBankReconciliation(): MonthlyBankReconciliation {
  return { revision: 0, deposits: [], carryover: 0, carryoverNote: "" };
}
