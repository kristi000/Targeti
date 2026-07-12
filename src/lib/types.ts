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
};

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
};

export type MonthlyShopData = {
  collection: number;
  targets: Target;
  representatives?: SalesRepresentative[];
  representativeTargets: Record<string, Target>;
  metricSettings?: MetricSettings;
  metricOrder?: PerformanceMetric[];
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
