"use server";

import { z } from "zod";
import type { DailyActivityMonth, DailyActivitySettings, SaveDailyActivitySettingsInput } from "@/lib/daily-activity";
import { loadDailyActivityMonth, loadDailyActivitySettings, persistDailyActivitySettings } from "@/lib/server/daily-activity";

export async function fetchDailyActivityMonth(shopId: string, month: string): Promise<DailyActivityMonth> {
  return loadDailyActivityMonth(shopId, month);
}

export async function fetchDailyActivitySettings(shopId: string, month: string): Promise<DailyActivitySettings | null> {
  return loadDailyActivitySettings(shopId, month);
}

export async function saveDailyActivitySettings(input: SaveDailyActivitySettingsInput) {
  try {
    return { success: true as const, data: await persistDailyActivitySettings(input) };
  } catch (error) {
    if (error instanceof Error && error.message === "DAILY_ACTIVITY_CONFLICT") {
      return { success: false as const, reason: "conflict" as const };
    }
    if (error instanceof z.ZodError) {
      console.error("Invalid Daily Activity settings", { issues: error.issues.map(issue => ({ path: issue.path, code: issue.code })) });
    } else {
      console.error("Failed to save Daily Activity settings", { code: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
    return { success: false as const, reason: "saveFailed" as const };
  }
}
