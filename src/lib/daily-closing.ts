import { getMetricWeight } from "@/lib/data";
import { getMetricOrder, getQuarterKey, getShopTargetMetrics, type DailyClosingDebt, type DailyClosingTotals, type MetricSettings, type PerformanceMetric, type Shop, type Target } from "@/lib/types";

export const DEFAULT_EXCHANGE_RATE = 92;

export const CASH_DENOMINATIONS = [
  { key: "lek_10000", label: "10,000", value: 10_000 },
  { key: "lek_5000", label: "5,000", value: 5_000 },
  { key: "lek_2000", label: "2,000", value: 2_000 },
  { key: "lek_1000", label: "1,000", value: 1_000 },
  { key: "lek_500", label: "500", value: 500 },
  { key: "lek_200", label: "200", value: 200 },
  { key: "lek_100", label: "100", value: 100 },
  { key: "lek_50", label: "50", value: 50 },
  { key: "lek_20", label: "20", value: 20 },
  { key: "lek_10", label: "10", value: 10 },
  { key: "lek_5", label: "5", value: 5 },
] as const;

export const EURO_DENOMINATION_KEY = "eur";

export function createEmptyCashCounts(): Record<string, number> {
  return Object.fromEntries([
    ...CASH_DENOMINATIONS.map(denomination => [denomination.key, 0]),
    [EURO_DENOMINATION_KEY, 0],
  ]);
}

export function getDailyClosingMetricConfig(shop: Shop, date: string) {
  const month = date.slice(0, 7);
  const monthData = shop.monthlyData?.[month];
  const quarterData = shop.quarterSettings?.[getQuarterKey(date)];
  const latestMonthData = Object.entries(shop.monthlyData ?? {})
    .sort(([left], [right]) => right.localeCompare(left))[0]?.[1];
  const targets = monthData?.targets ?? latestMonthData?.targets ?? shop.monthlyTargets;
  const metricSettings = monthData?.metricSettings ?? quarterData?.metricSettings ?? latestMonthData?.metricSettings ?? shop.metricSettings;
  const metricOrder = monthData?.metricOrder ?? quarterData?.metricOrder ?? latestMonthData?.metricOrder ?? shop.metricOrder;
  const configuredShop = { ...shop, metricSettings, metricOrder };

  if (monthData?.targets) {
    return {
      metrics: getShopTargetMetrics(configuredShop, monthData.targets),
      metricSettings,
      targets,
    };
  }

  if (metricOrder?.length) {
    const disabledMetrics = new Set(shop.disabledMetrics ?? []);
    return {
      metrics: getMetricOrder(metricOrder, metricOrder).filter(metric => !disabledMetrics.has(metric)),
      metricSettings,
      targets,
    };
  }

  return {
    metrics: getShopTargetMetrics(configuredShop, shop.monthlyTargets),
    metricSettings,
    targets,
  };
}

export function calculateDailyClosing(input: {
  cashCounts: Record<string, number>;
  exchangeRate: number;
  adjustments: { boss: number; invoice: number; unsubscribe: number };
  debts: DailyClosingDebt[];
  activities: Partial<Record<PerformanceMetric, number>>;
  metrics: readonly PerformanceMetric[];
  metricSettings?: MetricSettings;
  targets?: Target;
}): { totals: DailyClosingTotals; metricWeights: Partial<Record<PerformanceMetric, number>> } {
  const countedCash = CASH_DENOMINATIONS.reduce(
    (total, denomination) => total + denomination.value * (input.cashCounts[denomination.key] ?? 0),
    (input.cashCounts[EURO_DENOMINATION_KEY] ?? 0) * input.exchangeRate,
  );
  const debtTotal = input.debts.reduce((total, debt) => total + debt.amount, 0);
  const expectedCash = input.adjustments.boss + input.adjustments.invoice - debtTotal - input.adjustments.unsubscribe;
  const difference = countedCash - expectedCash;
  const metricWeights = Object.fromEntries(
    input.metrics.map(metric => [metric, getMetricWeight(metric, input.metricSettings)]),
  ) as Partial<Record<PerformanceMetric, number>>;
  const activityContributions = Object.fromEntries(
    input.metrics.map(metric => {
      const target = input.targets?.[metric] ?? 0;
      const contribution = target > 0
        ? ((input.activities[metric] ?? 0) / target) * (metricWeights[metric] ?? 0)
        : 0;
      return [metric, contribution];
    }),
  ) as Partial<Record<PerformanceMetric, number>>;
  const performanceScore = input.metrics.reduce(
    (total, metric) => total + (activityContributions[metric] ?? 0),
    0,
  );

  return {
    metricWeights,
    totals: {
      countedCash,
      debtTotal,
      expectedCash,
      difference,
      performanceScore,
      activityContributions,
    },
  };
}
