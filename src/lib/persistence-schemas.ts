import { z } from "zod";

import { performanceMetrics } from "@/lib/types";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format");
export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Expected a month in YYYY-MM format");
const documentIdSchema = z.string().trim().min(1).max(150).refine(value => !value.includes("/"), "Invalid document ID");
export const metricKeySchema = z.string().refine(
  value => (performanceMetrics as readonly string[]).includes(value) || /^custom_[A-Za-z0-9_-]{1,80}$/.test(value),
  "Invalid performance metric",
);
const finiteNonNegativeNumber = z.number().finite().nonnegative();
const finiteMoney = z.number().finite().nonnegative().max(1_000_000_000);

export const shopIdSchema = documentIdSchema;
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
  revenue: finiteNonNegativeNumber.optional(),
}).strict();

export const performanceDataListSchema = z.array(performanceDataSchema).max(450);

const dailyClosingDebtSchema = z.object({
  id: documentIdSchema,
  description: z.string().trim().min(1).max(200),
  amount: finiteMoney,
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

export const dailyClosingInputSchema = z.object({
  shopId: shopIdSchema,
  date: isoDateSchema,
  cashCounts: z.record(z.string().trim().min(1).max(40), z.number().int().nonnegative().max(1_000_000)),
  exchangeRate: z.number().finite().positive().max(1_000_000),
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
  action: z.enum(["excel_imported", "excel_import_undone", "excel_import_removed", "achievements_changed", "achievements_reverted", "targets_changed", "shop_created", "shop_edited", "shop_deleted", "supervisor_created", "supervisor_edited", "supervisor_deleted", "supervisor_assignments_changed", "representatives_deleted", "representatives_hidden", "representatives_unhidden", "metric_deleted", "daily_closing_saved", "daily_closing_finalized", "daily_closing_reopened", "all_data_deleted", "user_created", "user_role_changed"]),
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
