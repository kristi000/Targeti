"use server";

import { z } from "zod";
import { loadMonthlyBankReconciliation, saveMonthlyBank, saveMonthlyBankSchema } from "@/lib/server/monthly-bank";

export async function fetchMonthlyBankReconciliation(shopId: string, month: string) {
  return loadMonthlyBankReconciliation(shopId, month);
}

export async function saveMonthlyBankReconciliation(input: z.infer<typeof saveMonthlyBankSchema>) {
  try {
    return { success: true as const, data: await saveMonthlyBank(input) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error instanceof z.ZodError ? "invalidData"
      : message === "conflict" ? "conflict"
      : message === "UNAUTHENTICATED" ? "sessionExpired"
      : ["RESTRICTED_ACCESS_REQUIRED", "SHOP_ACCESS_REQUIRED", "EDITOR_REQUIRED"].includes(message) ? "accessDenied"
      : "saveFailed";
    return { success: false as const, error: code };
  }
}
