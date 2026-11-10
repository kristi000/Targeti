"use server";
import { z } from "zod";
import { measureServerOperation } from "@/lib/server/performance";
import { loadProcedures, saveProcedures, deleteProcedures, loadDeletedProcedures, restoreProcedures, type saveProceduresSchema, type deleteProceduresSchema } from "@/lib/server/procedures";
import type { ProcedureFilter, ProcedureSort } from "@/lib/procedures";

export async function fetchProcedures(shopId: string, month: string, cursor?: string, filter?: ProcedureFilter, sort?: ProcedureSort) {
  return measureServerOperation("procedures.page", () => loadProcedures(shopId, month, cursor, filter, sort));
}

export async function fetchDeletedProcedures(shopId: string, month: string, cursor?: string) {
  return loadDeletedProcedures(shopId, month, cursor);
}

export async function handleRestoreProcedures(input: z.infer<typeof deleteProceduresSchema>) {
  try { await restoreProcedures(input); return { success: true as const }; }
  catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "invalidData" };
    const known = ["conflict", "invalidData", "notFound", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    return { success: false as const, error: error instanceof Error && known.includes(error.message) ? error.message : "restoreFailed" };
  }
}

export async function handleSaveProcedures(input: z.infer<typeof saveProceduresSchema>) {
  try { await saveProcedures(input); return { success: true as const }; }
  catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "invalidData" };
    const known = ["conflict", "invalidData", "representativeRequired", "notFound", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    return { success: false as const, error: error instanceof Error && known.includes(error.message) ? error.message : "saveFailed" };
  }
}

export async function handleDeleteProcedures(input: z.infer<typeof deleteProceduresSchema>) {
  try { await deleteProcedures(input); return { success: true as const }; }
  catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "invalidData" };
    const known = ["conflict", "invalidData", "notFound", "UNAUTHENTICATED", "EDITOR_REQUIRED", "SHOP_ACCESS_REQUIRED"];
    return { success: false as const, error: error instanceof Error && known.includes(error.message) ? error.message : "deleteFailed" };
  }
}
