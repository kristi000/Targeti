import type { z } from "zod";
import type { procedureFieldsSchema, procedureRecordSchema, procedureSummarySchema, procedureFilterSchema, procedureSortSchema, deletedProcedureSchema } from "@/lib/persistence-schemas";
import type { SalesRepresentative } from "@/lib/types";

export const PROCEDURE_PRODUCTS = ["MixMax", "TRY&BUY"] as const;
export const PROCEDURE_STATUSES = ["pending", "completed", "negative"] as const;
export type ProcedureFields = z.infer<typeof procedureFieldsSchema>;
export type ProcedureRecord = z.infer<typeof procedureRecordSchema>;
export type DeletedProcedure = z.infer<typeof deletedProcedureSchema>;
export const deletedProceduresQueryKey = (shopId: string, month: string, cursor?: string) => [...proceduresQueryKey(shopId, month), "deleted", cursor ?? "first"] as const;
export type ProcedureSummary = z.infer<typeof procedureSummarySchema>;
export type ProcedureFilter = z.infer<typeof procedureFilterSchema>;
export type ProcedureSort = z.infer<typeof procedureSortSchema>;
export const procedurePageQueryKey = (shopId: string, month: string, filter: ProcedureFilter = {}, cursor?: string, sort: ProcedureSort = "source") => [...proceduresQueryKey(shopId, month), filter.product ?? "all", filter.status ?? "all", filter.user ?? null, sort, cursor ?? "first"] as const;
export const procedureProductStatus = (entry: Pick<ProcedureFields, "product" | "status">) => `${entry.product}:${entry.status}` as NonNullable<ProcedureRecord["productStatus"]>;
export type ProceduresPage = { items: ProcedureRecord[]; summary: ProcedureSummary; representatives: SalesRepresentative[]; nextCursor: string | null };
export const proceduresQueryKey = (shopId: string, month: string) => ["procedures", shopId, month] as const;
export const EMPTY_PROCEDURE_SUMMARY: ProcedureSummary = { revision: 0, total: 0, completed: 0, pending: 0, negative: 0, completedMixMax: 0, totalMixMax: 0, pendingMixMax: 0, totalTryBuy: 0, pendingTryBuy: 0, userTotals: [] };

export function adjustProcedureSummary(summary: ProcedureSummary, entry: ProcedureFields, direction: 1 | -1) {
  summary.total += direction;
  summary[entry.status] += direction;
  if (entry.status === "completed" && entry.product === "MixMax") summary.completedMixMax += direction;
  const totalKey = entry.product === "MixMax" ? "totalMixMax" : "totalTryBuy";
  const pendingKey = entry.product === "MixMax" ? "pendingMixMax" : "pendingTryBuy";
  summary[totalKey] = (summary[totalKey] ?? 0) + direction;
  if (entry.status === "pending") summary[pendingKey] = (summary[pendingKey] ?? 0) + direction;
  if (summary.userTotals !== undefined) {
    const previous = summary.userTotals.find(user => user.user === entry.user);
    const total = (previous?.total ?? 0) + direction;
    // Replace the array so shallow copies of the empty summary never share mutable counts.
    summary.userTotals = summary.userTotals.filter(user => user.user !== entry.user);
    if (total !== 0) summary.userTotals.push({ user: entry.user, total });
  }
}
