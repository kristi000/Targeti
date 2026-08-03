import {
  Smartphone,
  PlusCircle,
  ArrowRightLeft,
  FileSignature,
  FileClock,
  Tv2,
  MailPlus,
  Laptop,
} from "lucide-react";
import {
  type PerformanceData,
  type Target,
  type PerformanceMetricConfig,
  type PerformanceMetric,
  type MetricSettings,
  type Shop,
  getInitialTargets,
} from "@/lib/types";
import { CONSOLIDATED_EXCEL_METRIC_WEIGHTS, EXCEL_METRIC_LABELS } from "@/lib/metric-definitions";

export const SHOPS: Shop[] = [
  { 
    id: "shop1", 
    name: "Main Street", 
    description: "Our flagship store in the city center.", 
    salesRepresentatives: [
      {id: 'rep1', name: "Alice"}, 
      {id: 'rep2', name: "Bob"}
    ] 
  },
];

export const METRIC_CONFIG: PerformanceMetricConfig = {
  newSim: { label: EXCEL_METRIC_LABELS.newSim, icon: Smartphone },
  newLine: { label: EXCEL_METRIC_LABELS.newLine, icon: PlusCircle },
  migrations: { label: EXCEL_METRIC_LABELS.migrations, icon: ArrowRightLeft },
  fixContractRenewal: { label: EXCEL_METRIC_LABELS.fixContractRenewal, icon: FileSignature },
  mobileContractRenewal: {
    label: EXCEL_METRIC_LABELS.mobileContractRenewal,
    icon: FileClock,
  },
  newTv: { label: EXCEL_METRIC_LABELS.newTv, icon: Tv2 },
  newPostpaid: { label: EXCEL_METRIC_LABELS.newPostpaid, icon: MailPlus },
  device: { label: EXCEL_METRIC_LABELS.device, icon: Laptop },
};

export const METRIC_WEIGHTS: Record<PerformanceMetric, number> = CONSOLIDATED_EXCEL_METRIC_WEIGHTS;

export function getMetricWeight(metric: PerformanceMetric, metricSettings?: MetricSettings) {
  return metricSettings?.[metric]?.weight ?? (metric in METRIC_WEIGHTS ? METRIC_WEIGHTS[metric as keyof typeof METRIC_WEIGHTS] : 0.1);
}

const initialTargets: Target = getInitialTargets();

export const MONTHLY_TARGETS: Record<string, Target> = {
    "shop1": initialTargets
};

export const PERFORMANCE_DATA: Record<string, PerformanceData[]> = {
    "shop1": []
};
