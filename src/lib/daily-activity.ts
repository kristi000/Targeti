import { z } from "zod";

import { attendanceDateSchema, attendanceMonthSchema, dailyClosingSchema, metricKeySchema, procedureSummarySchema, shopIdSchema, targetSchema, weightProfileIdSchema } from "@/lib/persistence-schemas";
import type { ProcedureSummary } from "@/lib/procedures";
import type { MetricSettings, PerformanceMetric, Target } from "@/lib/types";

const settingsFieldsSchema = z.object({
  targets: targetSchema,
  metricOrder: z.array(metricKeySchema).min(1).max(100),
  metricSettings: z.record(metricKeySchema, z.object({
    label: z.string().trim().min(1).max(80).optional(),
    weight: z.number().finite().min(0).max(1),
  }).strict()),
  weightProfileId: weightProfileIdSchema.optional(),
}).strict();

function validateSettings(value: z.infer<typeof settingsFieldsSchema>, context: z.RefinementCtx) {
  const metrics = new Set(value.metricOrder);
  if (metrics.size !== value.metricOrder.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["metricOrder"], message: "Metrics must be unique." });
  }
  for (const field of ["targets", "metricSettings"] as const) {
    const keys = Object.keys(value[field]);
    if (keys.length !== metrics.size || keys.some(metric => !metrics.has(metric))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Every configured metric needs matching targets and weights." });
    }
  }
  const totalWeight = value.metricOrder.reduce((total, metric) => total + (value.metricSettings[metric]?.weight ?? 0), 0);
  if (Math.abs(totalWeight - 1) > 0.00001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["metricSettings"], message: "Metric weights must total exactly 100%." });
  }
  value.metricOrder.forEach(metric => {
    if ((value.metricSettings[metric]?.weight ?? 0) > 0 && !(value.targets[metric] > 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets", metric], message: "A weighted metric needs a positive target." });
    }
  });
}

export const dailyActivitySettingsFieldsSchema = settingsFieldsSchema.superRefine(validateSettings);
export const dailyActivitySettingsSchema = settingsFieldsSchema.extend({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.string().datetime({ offset: true }),
}).superRefine(validateSettings);
export const saveDailyActivitySettingsSchema = settingsFieldsSchema.extend({
  shopId: shopIdSchema,
  month: attendanceMonthSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
}).superRefine(validateSettings);
export const dailyActivityRequestSchema = z.object({ shopId: shopIdSchema, month: attendanceMonthSchema }).strict();
export const dailyActivityDaySchema = dailyClosingSchema.pick({ status: true, activities: true, updatedAt: true })
  .extend({ date: attendanceDateSchema });
export const dailyActivityActualsSchema = z.record(metricKeySchema, z.number().finite().nonnegative());
export const dailyActivityProcedureSummarySchema = procedureSummarySchema.refine(
  (summary): summary is ProcedureSummary & { totalMixMax: number; pendingMixMax: number; totalTryBuy: number; pendingTryBuy: number } =>
    summary.totalMixMax !== undefined && summary.pendingMixMax !== undefined
    && summary.totalTryBuy !== undefined && summary.pendingTryBuy !== undefined,
  "Procedure product totals are required.",
);
export const dailyActivityMonthSchema = z.object({
  settings: dailyActivitySettingsSchema.nullable(),
  days: z.array(dailyActivityDaySchema).max(31),
  actuals: dailyActivityActualsSchema,
  procedures: dailyActivityProcedureSummarySchema.nullable(),
}).strict();

export type DailyActivitySettings = {
  revision: number;
  targets: Target;
  metricOrder: PerformanceMetric[];
  metricSettings: MetricSettings;
  weightProfileId?: string;
  updatedAt: string;
};
export type DailyActivityDay = {
  date: string;
  status: "draft" | "finalized";
  activities: Partial<Record<PerformanceMetric, number>>;
  updatedAt: string;
};
export type DailyActivityMonth = {
  settings: DailyActivitySettings | null;
  days: DailyActivityDay[];
  actuals: Partial<Record<PerformanceMetric, number>>;
  procedures: ProcedureSummary | null;
};
export type DailyActivityProcedureMetric = {
  metric: "newLine" | "custom_mixmax";
  total: number;
  completed: number;
  pending: number;
  negative: number;
};
export type DailyActivityProcedureImpact = {
  actuals: DailyActivityMonth["actuals"];
  pendingActuals: DailyActivityMonth["actuals"];
  metrics: DailyActivityProcedureMetric[];
  includingPendingActuals: DailyActivityMonth["actuals"];
};
export type SaveDailyActivitySettingsInput = Pick<DailyActivitySettings, "targets" | "metricOrder" | "metricSettings" | "weightProfileId"> & {
  shopId: string;
  month: string;
  expectedRevision: number;
};

export const dailyActivityMonthQueryKey = (shopId: string, month: string) => ["daily-activity", shopId, month] as const;
export const dailyActivityQueryKey = dailyActivityMonthQueryKey;
export const dailyActivitySettingsQueryKey = (shopId: string, month: string) => ["daily-activity-settings", shopId, month] as const;

export function aggregateDailyActivity(days: DailyActivityDay[]): DailyActivityMonth["actuals"] {
  const actuals: DailyActivityMonth["actuals"] = {};
  for (const day of days) {
    for (const [metric, actual] of Object.entries(day.activities)) {
      const key = metric as PerformanceMetric;
      actuals[key] = (actuals[key] ?? 0) + (actual ?? 0);
    }
  }
  return dailyActivityActualsSchema.parse(actuals);
}

export function getDailyActivityProcedureImpact(
  rawActuals: DailyActivityMonth["actuals"],
  procedures: ProcedureSummary | null,
): DailyActivityProcedureImpact {
  const actuals = dailyActivityActualsSchema.parse(rawActuals);
  if (procedures === null) return { actuals, pendingActuals: {}, metrics: [], includingPendingActuals: { ...actuals } };
  const summary = dailyActivityProcedureSummarySchema.parse(procedures);
  // Procedures and Daily Closing describe the same sales; confirmed counts replace the two linked activity totals.
  actuals.newLine = summary.completed;
  actuals.custom_mixmax = summary.completedMixMax;
  const pendingActuals = { newLine: summary.pending, custom_mixmax: summary.pendingMixMax };
  const metrics: DailyActivityProcedureMetric[] = [
    { metric: "newLine", total: summary.total, completed: summary.completed, pending: summary.pending, negative: summary.negative },
    { metric: "custom_mixmax", total: summary.totalMixMax, completed: summary.completedMixMax,
      pending: summary.pendingMixMax, negative: summary.totalMixMax - summary.completedMixMax - summary.pendingMixMax },
  ];
  return {
    actuals,
    pendingActuals,
    metrics,
    includingPendingActuals: dailyActivityActualsSchema.parse({
      ...actuals, newLine: summary.completed + summary.pending, custom_mixmax: summary.completedMixMax + summary.pendingMixMax,
    }),
  };
}

export function calculateDailyActivity(
  actuals: DailyActivityMonth["actuals"],
  settings: Pick<DailyActivitySettings, "targets" | "metricOrder" | "metricSettings" | "weightProfileId">,
) {
  const validActuals = dailyActivityActualsSchema.parse(actuals);
  const validSettings = dailyActivitySettingsFieldsSchema.parse({
    targets: settings.targets,
    metricOrder: settings.metricOrder,
    metricSettings: settings.metricSettings,
    weightProfileId: settings.weightProfileId,
  });
  const rows = validSettings.metricOrder.map(metric => {
    const actual = validActuals[metric] ?? 0;
    const target = validSettings.targets[metric];
    const weight = validSettings.metricSettings[metric].weight;
    const achievement = target > 0 ? actual / target * 100 : null;
    const contribution = achievement === null ? 0 : achievement * weight;
    if ((achievement !== null && !Number.isFinite(achievement)) || !Number.isFinite(contribution)) {
      throw new Error("INVALID_DAILY_ACTIVITY_CALCULATION");
    }
    return { metric: metric as PerformanceMetric, actual, target, weight, achievement, contribution };
  });
  const total = rows.reduce((sum, row) => sum + row.contribution, 0);
  if (!Number.isFinite(total)) throw new Error("INVALID_DAILY_ACTIVITY_CALCULATION");
  return { rows, total };
}
