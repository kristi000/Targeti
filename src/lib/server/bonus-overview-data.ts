import "server-only";

import { adminDb } from "@/lib/firebase-admin";
import { bonusOverviewDocumentSchema, type BonusOverviewRow } from "@/lib/bonus-overview-index";

export type BonusOverviewMonth = { rows: BonusOverviewRow[]; missingShopIds: string[] };
export type AllTimeBonusRow = BonusOverviewRow & { monthsCount: number };

export async function readBonusOverviewMonth(month: string, shopIds: string[]): Promise<BonusOverviewMonth> {
  const documents = await adminDb.collection("bonusSummaries").doc(month).collection("shops").get();
  const allowed = new Set(shopIds);
  const cached = new Set<string>();
  const rows: BonusOverviewRow[] = [];
  for (const document of documents.docs) {
    if (!allowed.has(document.id)) continue;
    const parsed = bonusOverviewDocumentSchema.safeParse(document.data());
    if (parsed.success) {
      rows.push(...parsed.data.rows.filter(row => row.shopId === document.id));
      cached.add(document.id);
    } else if (document.data().schemaVersion !== 1) {
      console.error(`Ignoring invalid bonus summary ${document.ref.path}:`, parsed.error.flatten());
    }
  }
  return { rows, missingShopIds: shopIds.filter(shopId => !cached.has(shopId)) };
}

export async function readBonusOverviewAllTime(months: string[], shopIds: string[]) {
  const people = new Map<string, AllTimeBonusRow>();
  const missing: Array<{ month: string; shopIds: string[] }> = [];
  // Read a few months at a time so a long history cannot fill server memory.
  for (let start = 0; start < months.length; start += 3) {
    const results = await Promise.all(months.slice(start, start + 3).map(async month => ({
      month,
      ...await readBonusOverviewMonth(month, shopIds),
    })));
    for (const result of results) {
      if (result.missingShopIds.length) missing.push({ month: result.month, shopIds: result.missingShopIds });
      for (const row of result.rows) {
        const previous = people.get(row.id);
        people.set(row.id, previous
          ? { ...previous, amount: previous.amount + row.amount, monthsCount: previous.monthsCount + 1, finalized: previous.finalized && row.finalized }
          : { ...row, forecastAmount: null, forecastAsOf: null, monthsCount: 1 });
      }
    }
  }
  return { rows: [...people.values()], missing };
}
