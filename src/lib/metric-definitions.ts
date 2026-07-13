import type { MetricSettings, PerformanceMetric, Target } from "@/lib/types";

export function getCustomMetricLabel(metric: PerformanceMetric, metricSettings?: MetricSettings) {
  const configuredLabel = metricSettings?.[metric]?.label?.trim();
  if (configuredLabel) return configuredLabel;
  return metric.slice("custom_".length).replace(/_\d+$/, "").replace(/_/g, " ");
}

export const EXCEL_METRIC_LABELS: Record<PerformanceMetric, string> = {
  newSim: "Numra te rinj te shendetshem perfshire bartjet",
  newLine: "Lidhje te reja Fiber + xDSL",
  migrations: "Migrime Hybrid/Postpaid",
  fixContractRenewal: "Numra te rinj me kontrate perfshire bartjet",
  mobileContractRenewal: "Rinovime te numrave me kontrate",
  newTv: "Lidhje te reja Home Net",
  newPostpaid: "Rinovime internet",
  device: "Shitje_Telefonash",
};

export const DEFAULT_MONTHLY_TARGETS: Target = {
  newSim: 162,
  newLine: 15,
  migrations: 46,
  fixContractRenewal: 19,
  mobileContractRenewal: 155,
  newTv: 9,
  newPostpaid: 29,
  device: 253_000,
};

export const CONSOLIDATED_EXCEL_METRIC_WEIGHTS: Record<PerformanceMetric, number> = {
  custom_mixmax: 0.15,
  newLine: 0.20,
  newTv: 0.05,
  newSim: 0.15,
  newPostpaid: 0.05,
  migrations: 0.20,
  mobileContractRenewal: 0.05,
  device: 0.05,
  fixContractRenewal: 0.10,
};
