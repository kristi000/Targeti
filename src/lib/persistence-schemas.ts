import { z } from "zod";

import { performanceMetrics } from "@/lib/types";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");
export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Expected a month in YYYY-MM format");
const documentIdSchema = z.string().trim().min(1).max(150).refine(value => !value.includes("/"), "Invalid document ID");
export const metricKeySchema = z.string().refine(
  value => (performanceMetrics as readonly string[]).includes(value) || /^custom_[A-Za-z0-9_-]{1,80}$/.test(value),
  "Invalid performance metric",
);
const finiteNonNegativeNumber = z.number().finite().nonnegative();
const finiteMoney = z.number().finite().nonnegative().max(1_000_000_000);

export const shopIdSchema = documentIdSchema;
export const weightProfileIdSchema = documentIdSchema;
export const supervisorIdSchema = documentIdSchema;
export const supervisorSchema = z.object({
  id: supervisorIdSchema,
  name: z.string().trim().min(1).max(120),
}).strict();
export const newSupervisorSchema = supervisorSchema.omit({ id: true });
export const targetSchema = z.record(metricKeySchema, finiteNonNegativeNumber);

const representativeSchema = z.object({
  id: documentIdSchema,
  name: z.string().trim().min(1).max(120),
}).strict();

const metricSettingSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  weight: finiteNonNegativeNumber.optional(),
}).strict();

const metricSettingsSchema = z.record(metricKeySchema, metricSettingSchema);
const metricOrderSchema = z.array(metricKeySchema).max(100);
const metricWeightProfileObjectSchema = z.object({
  id: weightProfileIdSchema,
  name: z.string().trim().min(1).max(80),
  metricSettings: metricSettingsSchema,
  metricOrder: metricOrderSchema.min(1),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

const validateMetricWeightProfile = (value: z.infer<typeof metricWeightProfileObjectSchema>, context: z.RefinementCtx) => {
  if (new Set(value.metricOrder).size !== value.metricOrder.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile metrics must be unique." });
  }
  const total = value.metricOrder.reduce((sum, metric) => sum + Number(value.metricSettings[metric]?.weight ?? 0), 0);
  if (Math.abs(total - 1) > 0.00001) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile weights must total exactly 100%." });
  }
  value.metricOrder.forEach(metric => {
    if (!value.metricSettings[metric]?.label?.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Every profile metric needs a name." });
    }
    if (Number(value.metricSettings[metric]?.weight ?? 0) > 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile weights cannot exceed 100%." });
    }
  });
  const labels = value.metricOrder.map(metric => value.metricSettings[metric]?.label?.trim().toLocaleLowerCase());
  if (new Set(labels).size !== labels.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile metric names must be unique." });
  }
};

export const metricWeightProfileSchema = metricWeightProfileObjectSchema.superRefine(validateMetricWeightProfile);
export const newMetricWeightProfileSchema = metricWeightProfileObjectSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .superRefine((value, context) => validateMetricWeightProfile({ id: "new-profile", ...value }, context));
const qualityMetricsSchema = z.object({
  checklistScore: finiteNonNegativeNumber.optional(),
  npsScore: z.number().finite().min(-100).max(100).optional(),
  npsResponses: finiteNonNegativeNumber.optional(),
}).strict();

const representativePerformanceSchema = z.object({
  repId: documentIdSchema,
  repName: z.string().trim().min(1).max(120).optional(),
}).catchall(finiteNonNegativeNumber);

const achievementOverrideSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  originalReps: z.array(representativePerformanceSchema).max(500),
  originalShopActuals: z.record(metricKeySchema, finiteNonNegativeNumber).optional(),
}).strict();

export const performanceDataSchema = z.object({
  id: documentIdSchema.optional(),
  date: isoDateSchema,
  reps: z.array(representativePerformanceSchema).max(500),
  shopActuals: z.record(metricKeySchema, finiteNonNegativeNumber).optional(),
  achievementOverride: achievementOverrideSchema.optional(),
  importId: documentIdSchema.optional(),
  importName: z.string().trim().min(1).max(255).optional(),
  importedAt: z.string().datetime({ offset: true }).optional(),
  reportType: z.enum(["midMonth", "completedMonth"]).optional(),
  asOfDate: isoDateSchema.optional(),
  includeInOverview: z.boolean().optional(),
  qualityMetrics: qualityMetricsSchema.optional(),
  targets: targetSchema.optional(),
  representativeTargets: z.record(documentIdSchema, targetSchema).optional(),
  metricSettings: metricSettingsSchema.optional(),
  metricOrder: metricOrderSchema.optional(),
  revenue: finiteNonNegativeNumber.optional(),
}).strict();

export const performanceDataListSchema = z.array(performanceDataSchema).max(450);

const dailyClosingDebtSchema = z.object({
  id: documentIdSchema,
  description: z.string().trim().min(1).max(200),
  amount: finiteMoney,
  paidAt: z.string().datetime().optional(),
}).strict();

export const debtMutationSchema = z.object({
  shopId: shopIdSchema,
  date: isoDateSchema,
  debtId: documentIdSchema,
  expectedUpdatedAt: z.string().datetime(),
  change: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("edit"), description: dailyClosingDebtSchema.shape.description, amount: finiteMoney }).strict(),
    z.object({ kind: z.literal("payment"), paid: z.boolean() }).strict(),
  ]),
}).strict();

const dailyClosingUnsubscribeEntrySchema = z.object({
  id: documentIdSchema,
  invoice: z.string().trim().min(1).max(100),
  msisdn: z.string().trim().min(1).max(40),
  amount: finiteMoney,
}).strict();

const dailyClosingAdjustmentsSchema = z.object({
  boss: finiteMoney,
  invoice: finiteMoney,
  unsubscribe: finiteMoney,
}).strict();

const dailyClosingCellSchema = z.object({
  amount: finiteMoney,
  note: z.string().trim().max(500),
}).strict();

export const dailyClosingInputSchema = z.object({
  shopId: shopIdSchema,
  date: isoDateSchema,
  cashCounts: z.record(z.string().trim().min(1).max(40), z.number().int().nonnegative().max(1_000_000)),
  exchangeRate: z.number().finite().positive().max(1_000_000),
  cell: dailyClosingCellSchema.default({ amount: 0, note: "" }),
  adjustments: dailyClosingAdjustmentsSchema,
  debts: z.array(dailyClosingDebtSchema).max(100),
  unsubscribeEntries: z.array(dailyClosingUnsubscribeEntrySchema).max(100).default([]),
  activities: z.record(metricKeySchema, finiteNonNegativeNumber),
}).strict();

const dailyClosingTotalsSchema = z.object({
  countedCash: z.number().finite(),
  debtTotal: z.number().finite(),
  expectedCash: z.number().finite(),
  difference: z.number().finite(),
  performanceScore: z.number().finite(),
  rating: z.enum(["veryWeak", "weak", "good", "veryGood", "super"]).optional(),
  activityContributions: z.record(metricKeySchema, z.number().finite()),
}).strict();

export const dailyClosingSchema = dailyClosingInputSchema.omit({ shopId: true }).extend({
  id: documentIdSchema.optional(),
  status: z.enum(["draft", "finalized"]),
  metricWeights: z.record(metricKeySchema, finiteNonNegativeNumber),
  metricTargets: z.record(metricKeySchema, finiteNonNegativeNumber).optional(),
  totals: dailyClosingTotalsSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  finalizedAt: z.string().datetime({ offset: true }).optional(),
  finalizedBy: z.string().trim().min(1).max(255).optional(),
}).strict();

const monthlyShopDataSchema = z.object({
  collection: finiteNonNegativeNumber,
  targets: targetSchema,
  representatives: z.array(representativeSchema).max(500).optional(),
  representativeTargets: z.record(documentIdSchema, targetSchema),
  metricSettings: metricSettingsSchema.optional(),
  metricOrder: metricOrderSchema.optional(),
  qualityMetrics: qualityMetricsSchema.optional(),
}).strict();

const quarterMetricSettingsSchema = z.object({
  metricSettings: metricSettingsSchema,
  metricOrder: metricOrderSchema,
}).strict();

export const shopSchema = z.object({
  id: documentIdSchema,
  name: z.string().trim().min(1).max(120),
  supervisorId: supervisorIdSchema.optional(),
  description: z.string().trim().max(500).optional(),
  revenue: finiteNonNegativeNumber.optional(),
  salesRepresentatives: z.array(representativeSchema).max(500).optional(),
  hiddenSalesRepresentatives: z.array(representativeSchema).max(500).optional(),
  monthlyTargets: targetSchema.optional(),
  metricSettings: metricSettingsSchema.optional(),
  metricOrder: metricOrderSchema.optional(),
  disabledMetrics: metricOrderSchema.optional(),
  weightProfileId: weightProfileIdSchema.optional(),
  monthlyData: z.record(monthSchema, monthlyShopDataSchema).optional(),
  quarterSettings: z.record(
    z.string().regex(/^\d{4}-Q[1-4]$/),
    quarterMetricSettingsSchema,
  ).optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const newShopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
}).strict();

export const bonusSnapshotSchema = z.object({
  month: monthSchema,
  finalizedAt: z.string().datetime({ offset: true }),
  calculationVersion: z.string().trim().min(1).max(80),
  payoutTableVersion: z.string().trim().min(1).max(80),
  inputs: z.object({
    collection: finiteNonNegativeNumber,
    targets: targetSchema,
    representativeTargets: z.record(documentIdSchema, targetSchema),
    metricSettings: metricSettingsSchema.optional(),
    metricOrder: metricOrderSchema,
    shopActuals: z.record(metricKeySchema, finiteNonNegativeNumber),
    representativeActuals: z.record(documentIdSchema, z.record(metricKeySchema, finiteNonNegativeNumber)),
  }).strict(),
  manager: z.record(z.unknown()),
  representatives: z.array(z.object({
    id: documentIdSchema,
    name: z.string().trim().min(1).max(120),
    eligible: z.boolean(),
    result: z.record(z.unknown()),
  }).strict()).max(500),
}).strict();

export const activityEventSchema = z.object({
  id: documentIdSchema.optional(),
  action: z.enum(["excel_imported", "excel_import_undone", "excel_import_removed", "achievements_changed", "achievements_reverted", "targets_changed", "shop_created", "shop_edited", "shop_deleted", "supervisor_created", "supervisor_edited", "supervisor_deleted", "supervisor_assignments_changed", "representatives_deleted", "representatives_hidden", "representatives_unhidden", "metric_deleted", "weight_profile_created", "weight_profile_edited", "weight_profile_deleted", "weight_profile_assignments_changed", "daily_closing_saved", "daily_closing_finalized", "daily_closing_reopened", "all_data_deleted", "user_created", "user_role_changed"]),
  occurredAt: z.string().datetime({ offset: true }),
  actor: z.object({
    id: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(120),
    username: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(255).optional(),
    role: z.enum(["admin", "editor", "viewer"]),
  }).strict().refine(actor => Boolean(actor.username || actor.email), "An actor username is required."),
  summary: z.string().trim().min(1).max(500),
  shopIds: z.array(documentIdSchema).max(500),
  shopNames: z.array(z.string().trim().min(1).max(120)).max(500),
  metadata: z.record(z.union([z.string(), z.number().finite(), z.boolean()])).optional(),
}).strict();
