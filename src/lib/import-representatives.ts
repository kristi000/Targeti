import type { ImportedShopData } from "@/lib/excel-import";
import {
  getMonthlyRepresentatives,
  getOverviewPerformanceData,
  type PerformanceData,
  type SalesRepresentative,
  type Shop,
} from "@/lib/types";

export type ImportedRepresentativeVisibilityMode = "respectHidden" | "includeAll";

export function normalizeRepresentativeName(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function hiddenRepresentativesForImport(shop: Shop, month: string, performanceData: PerformanceData[]): SalesRepresentative[] {
  const visibleRepresentatives = getMonthlyRepresentatives(shop, month);
  const visibleIds = new Set(visibleRepresentatives.map(representative => representative.id));
  const visibleNames = new Set(visibleRepresentatives.map(representative => normalizeRepresentativeName(representative.name)));
  const hiddenById = new Map((shop.hiddenSalesRepresentatives ?? []).map(representative => [representative.id, representative]));

  getOverviewPerformanceData(performanceData)
    .filter(entry => entry.date.startsWith(month))
    .flatMap(entry => entry.reps)
    .forEach(representative => {
      if (
        representative.repName
        && !visibleIds.has(representative.repId)
        && !visibleNames.has(normalizeRepresentativeName(representative.repName))
        && !hiddenById.has(representative.repId)
      ) {
        hiddenById.set(representative.repId, { id: representative.repId, name: representative.repName });
      }
    });

  return Array.from(hiddenById.values());
}

export function getIncludedImportRepresentatives(
  representatives: ImportedShopData["representatives"],
  hiddenRepresentatives: readonly SalesRepresentative[],
  mode: ImportedRepresentativeVisibilityMode,
): ImportedShopData["representatives"] {
  if (mode === "includeAll") return [...representatives];

  const hiddenIds = new Set(hiddenRepresentatives.map(representative => representative.id));
  const hiddenNames = new Set(hiddenRepresentatives.map(representative => normalizeRepresentativeName(representative.name)));
  return representatives.filter(representative =>
    !hiddenIds.has(representative.id) && !hiddenNames.has(normalizeRepresentativeName(representative.name)),
  );
}

export function shouldPreserveImportShopDefaults(
  shop: Pick<Shop, "monthlyData"> | null | undefined,
  reportingMonth: string,
  calendarMonth: string,
  performanceData: readonly Pick<PerformanceData, "date">[] = [],
) {
  return reportingMonth < calendarMonth
    || Object.keys(shop?.monthlyData ?? {}).some(month => month > reportingMonth)
    || performanceData.some(entry => entry.date.slice(0, 7) > reportingMonth);
}
