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

export type PerformanceMetric = (typeof performanceMetrics)[number];

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
    newSim: 100,
    newLine: 120,
    migrations: 50,
    fixContractRenewal: 80,
    mobileContractRenewal: 90,
    newTv: 40,
    newPostpaid: 70,
    device: 60,
  };
}


export type MetricConfig = {
  label: string;
  icon: LucideIcon;
};

export type PerformanceMetricConfig = Record<PerformanceMetric, MetricConfig>;

export type Shop = {
  id: string;
  name: string;
  description?: string;
  salesRepresentatives?: SalesRepresentative[];
  monthlyTargets?: Target;
};
