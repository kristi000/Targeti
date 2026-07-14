import { type LucideIcon } from "lucide-react";

export const performanceMetrics = [
  "newSim",
  "newLine",
  "migrations",
  "fixContractRenewal",
  "mobileContractRenewal",
  "newTv",
  "newPostpaid",
  "device",
] as const;

export type BasePerformanceMetric = (typeof performanceMetrics)[number];
export type PerformanceMetric = BasePerformanceMetric | `custom_${string}`;

export function getMetricOrder(
  metricOrder?: readonly PerformanceMetric[],
  availableMetrics: readonly PerformanceMetric[] = performanceMetrics,
): PerformanceMetric[] {
  const savedMetrics = (metricOrder ?? []).filter(
    (metric, index, metrics) => availableMetrics.includes(metric) && metrics.indexOf(metric) === index
  );

  return [...savedMetrics, ...availableMetrics.filter((metric) => !savedMetrics.includes(metric))];
}

export function getShopMetrics(shop?: Pick<Shop, "metricSettings" | "metricOrder" | "monthlyTargets">, targets?: Target): PerformanceMetric[] {
  const available = [...performanceMetrics] as PerformanceMetric[];
  const candidates = [
    ...(shop?.metricOrder ?? []),
    ...Object.keys(shop?.metricSettings ?? {}),
    ...Object.keys(targets ?? shop?.monthlyTargets ?? {}),
  ] as PerformanceMetric[];
  candidates.forEach(metric => { if (!available.includes(metric)) available.push(metric); });
  return getMetricOrder(shop?.metricOrder, available);
}

export type SalesRepresentative = {
  id: string;
  name: string;
};

export type RepPerformanceData = {
  repId: string;
} & Omit<Record<PerformanceMetric, number>, "repName"> & { repName?: string };


export type PerformanceData = {
  id?: string;
  date: string; // YYYY-MM-DD
  reps: RepPerformanceData[];
  shopActuals?: Partial<Record<PerformanceMetric, number>>;
  importId?: string;
  importName?: string;
  importedAt?: string;
  reportType?: "midMonth" | "completedMonth";
  asOfDate?: string;
  includeInOverview?: boolean;
  qualityMetrics?: QualityMetrics;
  targets?: Target;
  revenue?: number;
};

export type QualityMetrics = {
  checklistScore?: number;
  npsScore?: number;
  npsResponses?: number;
};

export function getActivePerformanceData(data: PerformanceData[]): PerformanceData[] {
  const latestExcelByMonth = new Map<string, PerformanceData>();
  const manualEntries: PerformanceData[] = [];

  data.forEach(entry => {
    if (!entry.importId) {
      manualEntries.push(entry);
      return;
    }

    const month = entry.date.slice(0, 7);
    const current = latestExcelByMonth.get(month);
    const entryTime = entry.importedAt ?? entry.date;
    const currentTime = current?.importedAt ?? current?.date ?? "";
    if (!current || entryTime > currentTime) latestExcelByMonth.set(month, entry);
  });

  const effectiveManualEntries = manualEntries.filter(entry => !latestExcelByMonth.has(entry.date.slice(0, 7)));
  return [...effectiveManualEntries, ...latestExcelByMonth.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function getOverviewPerformanceData(data: PerformanceData[]): PerformanceData[] {
  return getActivePerformanceData(data).filter(entry => entry.includeInOverview !== false);
}

export function getQuarterKey(date: string) {
  const [year, monthText] = date.slice(0, 7).split("-");
  const month = Number(monthText);
  const quarter = Math.min(Math.max(Math.ceil(month / 3), 1), 4);
  return `${year}-Q${quarter}`;
}

export function getPerformanceDatasetId(data: PerformanceData) {
  return data.importId ?? data.id ?? data.date;
}

export function getPerformanceShopActuals(data: PerformanceData[], metrics: readonly PerformanceMetric[]) {
  return metrics.reduce((totals, metric) => {
    totals[metric] = data.reduce((sum, day) => sum + (
      day.shopActuals?.[metric]
      ?? day.reps.reduce((representativeSum, representative) => representativeSum + (representative[metric] ?? 0), 0)
    ), 0);
    return totals;
  }, {} as Record<PerformanceMetric, number>);
}

export type Target = Record<PerformanceMetric, number>;

export function getInitialTargets(): Target {
  return {
    newSim: 162,
    newLine: 15,
    migrations: 46,
    fixContractRenewal: 19,
    mobileContractRenewal: 155,
    newTv: 9,
    newPostpaid: 29,
    device: 253_000,
  };
}


export type MetricConfig = {
  label: string;
  icon: LucideIcon;
};

export type PerformanceMetricConfig = Record<BasePerformanceMetric, MetricConfig>;

export type MetricSetting = {
  label?: string;
  weight?: number;
};

export type MetricSettings = Partial<Record<PerformanceMetric, MetricSetting>>;

export type Shop = {
  id: string;
  name: string;
  description?: string;
  revenue?: number;
  salesRepresentatives?: SalesRepresentative[];
  monthlyTargets?: Target;
  metricSettings?: MetricSettings;
  metricOrder?: PerformanceMetric[];
  monthlyData?: Record<string, MonthlyShopData>;
  quarterSettings?: Record<string, QuarterMetricSettings>;
};

export type QuarterMetricSettings = {
  metricSettings: MetricSettings;
  metricOrder: PerformanceMetric[];
};

export type MonthlyShopData = {
  collection: number;
  targets: Target;
  representatives?: SalesRepresentative[];
  representativeTargets: Record<string, Target>;
  metricSettings?: MetricSettings;
  metricOrder?: PerformanceMetric[];
  qualityMetrics?: QualityMetrics;
};

export function getMonthlyRepresentatives(shop: Shop, month: string): SalesRepresentative[] {
  return shop.monthlyData?.[month]?.representatives ?? shop.salesRepresentatives ?? [];
}

export type BonusSnapshot = {
  month: string;
  finalizedAt: string;
  calculationVersion: string;
  payoutTableVersion: string;
  inputs: {
    collection: number;
    targets: Target;
    representativeTargets: Record<string, Target>;
    metricSettings?: MetricSettings;
    metricOrder: PerformanceMetric[];
    shopActuals: Record<string, number>;
    representativeActuals: Record<string, Record<string, number>>;
  };
  manager: ReturnType<typeof import("./manager-bonus").calculateManagerBonus>;
  representatives: Array<{
    id: string;
    name: string;
    eligible: boolean;
    result: ReturnType<typeof import("./sales-representative-bonus").calculateRepresentativeBonus>;
  }>;
};
