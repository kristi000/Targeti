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
const attendanceTextSchema = z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), "Invalid attendance text");
export const attendanceDateSchema = isoDateSchema.refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export const attendanceMonthSchema = monthSchema.refine(value => Number(value.slice(5)) >= 1 && Number(value.slice(5)) <= 12, "Invalid month");
const procedureTextSchema = z.string().trim().min(1).max(150).refine(value => !/[\u0000-\u001f]/.test(value), "Invalid procedure text");
export const procedureDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).refine(value => attendanceDateSchema.safeParse(value.slice(0, 10)).success, "Invalid procedure date");
export const procedureFieldsSchema = z.object({
  orderNumber: procedureTextSchema, name: procedureTextSchema, customerId: procedureTextSchema,
  product: z.enum(["MixMax", "TRY&BUY"]), dateTime: procedureDateTimeSchema,
  user: procedureTextSchema, status: z.enum(["pending", "completed", "negative"]),
}).strict();
export const procedureFilterSchema = z.object({
  product: procedureFieldsSchema.shape.product.optional(), status: procedureFieldsSchema.shape.status.optional(),
  user: procedureFieldsSchema.shape.user.optional(),
}).strict();
export const procedureSortSchema = z.enum(["source", "userAsc", "userDesc"]);
export const procedureUserOrderKeySchema = z.string().min(1).max(1499)
  .refine(value => new TextEncoder().encode(value).length <= 1499, "Procedure sort key is too long");
export const procedureRecordSchema = procedureFieldsSchema.extend({
  productStatus: z.enum(["MixMax:pending", "MixMax:completed", "MixMax:negative", "TRY&BUY:pending", "TRY&BUY:completed", "TRY&BUY:negative"]).optional(),
  userOrder: procedureUserOrderKeySchema.optional(), productUserOrder: procedureUserOrderKeySchema.optional(),
  statusUserOrder: procedureUserOrderKeySchema.optional(), productStatusUserOrder: procedureUserOrderKeySchema.optional(),
  userFilterOrder: procedureUserOrderKeySchema.optional(), productUserFilterOrder: procedureUserOrderKeySchema.optional(),
  statusUserFilterOrder: procedureUserOrderKeySchema.optional(), productStatusUserFilterOrder: procedureUserOrderKeySchema.optional(),
  id: documentIdSchema, month: attendanceMonthSchema, revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), updatedBy: documentIdSchema,
  source: z.object({ fileHash: z.string().regex(/^[a-f0-9]{64}$/), row: z.number().int().min(2), originalDateTime: procedureDateTimeSchema }).strict().optional(),
}).strict();
export const deletedProcedureSchema = procedureRecordSchema.extend({
  deletedAt: z.string().datetime(), deletedBy: documentIdSchema,
}).strict();
export const procedureSummarySchema = z.object({
  filterIndexVersion: z.literal(1).optional(),
  userSortIndexVersion: z.literal(1).optional(),
  userFilterIndexVersion: z.literal(1).optional(),
  userNameIndexRosterHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  revision: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), negative: z.number().int().nonnegative(),
  completedMixMax: z.number().int().nonnegative(),
  totalMixMax: z.number().int().nonnegative().optional(), pendingMixMax: z.number().int().nonnegative().optional(),
  totalTryBuy: z.number().int().nonnegative().optional(), pendingTryBuy: z.number().int().nonnegative().optional(),
  userTotals: z.array(z.object({ user: procedureFieldsSchema.shape.user, total: z.number().int().positive() }).strict()).optional(),
}).strict().refine(value => {
  if (value.total !== value.completed + value.pending + value.negative || value.completedMixMax > value.completed) return false;
  if (value.userTotals && (new Set(value.userTotals.map(entry => entry.user)).size !== value.userTotals.length
    || value.userTotals.reduce((total, entry) => total + entry.total, 0) !== value.total)) return false;
  const products = [value.totalMixMax, value.pendingMixMax, value.totalTryBuy, value.pendingTryBuy];
  if (products.every(count => count === undefined)) return true; // Older summaries are rebuilt on first access.
  return value.totalMixMax !== undefined && value.pendingMixMax !== undefined && value.totalTryBuy !== undefined && value.pendingTryBuy !== undefined
    && value.totalMixMax + value.totalTryBuy === value.total && value.pendingMixMax + value.pendingTryBuy === value.pending
    && value.completedMixMax + value.pendingMixMax <= value.totalMixMax
    && value.completed - value.completedMixMax + value.pendingTryBuy <= value.totalTryBuy;
}, "Invalid procedure totals");
export const attendanceStaffSchema = z.object({
  id: documentIdSchema,
  name: z.string().trim().min(1).max(120).pipe(attendanceTextSchema),
  role: z.enum(["SM", "SR", "IE"]),
}).strict();
export const attendanceEntrySchema = z.object({
  staffId: documentIdSchema,
  code: z.enum(["1", "2", "1+2", "P", "LV", "R", "OTHER"]),
  note: z.string().trim().max(200).pipe(attendanceTextSchema).default(""),
  originalText: z.string().max(250).pipe(attendanceTextSchema).optional(),
}).strict().refine(value => value.code !== "OTHER" || value.note.length > 0, "Other attendance requires a note");
export const attendanceDaySchema = z.preprocess(value => {
  // Discard the obsolete status on legacy stored documents.
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const day = { ...value } as Record<string, unknown>;
  delete day.state;
  return day;
}, z.object({
  date: attendanceDateSchema,
  entries: z.array(attendanceEntrySchema).max(50),
  updatedAt: z.string().datetime(),
  updatedBy: documentIdSchema,
}).strict().refine(value => new Set(value.entries.map(entry => entry.staffId)).size === value.entries.length, "Duplicate staff entry"));
export const attendanceRosterSchema = z.array(attendanceStaffSchema).min(1).max(50).refine(value => new Set(value.map(staff => staff.id)).size === value.length, "Duplicate staff ID");
export const attendanceMonthConfigSchema = z.object({
  staff: attendanceRosterSchema,
  revision: z.number().int().nonnegative(),
  template: z.object({
    id: documentIdSchema,
    sheet: z.string().min(1).max(31),
    month: attendanceMonthSchema,
    sourceMonth: attendanceMonthSchema.optional(),
    fileName: z.string().min(1).max(255),
    columns: z.array(z.object({ column: z.number().int().min(3).max(26), staffId: documentIdSchema }).strict()).max(24),
  }).strict().optional(),
}).strict();
export const attendanceHistoryIdSchema = z.string().regex(/^\d{16}$/);
export const attendanceHistorySchema = z.object({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.string().datetime(),
  actorId: documentIdSchema,
  actorName: z.string().min(1).max(120),
  source: z.enum(["edit", "import", "roster"]),
  dates: z.array(attendanceDateSchema).max(31),
  rosterChanged: z.boolean(),
  templateChanged: z.boolean(),
}).strict();
export const attendanceHistoryDetailSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("day"), date: attendanceDateSchema,
    changes: z.array(z.object({
      staffId: documentIdSchema, name: z.string().min(1).max(120),
      before: attendanceEntrySchema.nullable(), after: attendanceEntrySchema.nullable(),
    }).strict()).max(100),
  }).strict(),
  z.object({
    kind: z.literal("roster"),
    changes: z.array(z.object({
      before: attendanceStaffSchema.nullable(), after: attendanceStaffSchema.nullable(),
      beforePosition: z.number().int().min(1).max(50).optional(),
      afterPosition: z.number().int().min(1).max(50).optional(),
    }).strict()).max(100),
  }).strict(),
]);
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
  year: z.number().int().min(2000).max(9999).nullable().optional(),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  group: z.string().trim().min(1).max(80).optional(),
  metricSettings: metricSettingsSchema,
  metricOrder: metricOrderSchema.min(1),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

const validateMetricWeightProfile = (value: z.infer<typeof metricWeightProfileObjectSchema>, context: z.RefinementCtx) => {
  if ((value.year === undefined) !== (value.quarter === undefined)
    || (value.year === null) !== (value.quarter === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile quarter and year must be provided together, or both set to all periods." });
  }
  if (value.group !== undefined && value.year === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A profile group requires an explicit reporting period or all periods." });
  }
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
  attendance: z.array(attendanceEntrySchema).max(50).optional(),
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
  sourceImportId: documentIdSchema.optional(),
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

export const quarterSchema = z.string().regex(/^\d{4}-Q[1-4]$/);

const quarterlyResultSchema = z.object({
  quarter: quarterSchema,
  months: z.array(monthSchema).length(3),
  shopMonths: z.array(z.object({ month: monthSchema, performance: z.number().finite(), collection: finiteNonNegativeNumber }).strict()).length(3),
  shopAverage: z.number().finite(),
  averageCollection: finiteNonNegativeNumber,
  manager: z.object({ eligible: z.boolean(), groupName: z.string(), baseBonus: finiteNonNegativeNumber, shopRate: finiteNonNegativeNumber, totalBonus: finiteNonNegativeNumber }).strict(),
  representatives: z.array(z.object({
    id: documentIdSchema,
    name: z.string().trim().min(1),
    monthly: z.array(z.object({ month: monthSchema, active: z.boolean(), performance: z.number().finite().nullable() }).strict()).length(3),
    activeAllMonths: z.boolean(),
    individualAverage: z.number().finite().nullable(),
    eligible: z.boolean(),
    groupName: z.string(),
    baseBonus: finiteNonNegativeNumber,
    individualRate: finiteNonNegativeNumber,
    shopRate: finiteNonNegativeNumber,
    totalBonus: finiteNonNegativeNumber,
  }).strict()).max(500),
  totalBonus: finiteNonNegativeNumber,
}).strict();

export const quarterlyBonusSnapshotSchema = z.object({
  quarter: quarterSchema,
  finalizedAt: z.string().datetime({ offset: true }),
  sourceImportId: documentIdSchema.optional(),
  calculationVersion: z.string().trim().min(1).max(80),
  payoutTableVersion: z.string().trim().min(1).max(80),
  monthlySources: z.array(z.object({
    month: monthSchema,
    finalizedAt: z.string().datetime({ offset: true }),
  }).strict()).length(3),
  result: quarterlyResultSchema,
}).strict().refine(snapshot => snapshot.result.quarter === snapshot.quarter
  && snapshot.monthlySources.every((source, index) => source.month === snapshot.result.months[index])
  && snapshot.result.shopMonths.every((source, index) => source.month === snapshot.result.months[index]), "Quarterly source months do not match.");

export const activityEventSchema = z.object({
  id: documentIdSchema.optional(),
  action: z.enum(["procedures_saved", "procedures_imported", "procedures_deleted", "procedures_restored", "attendance_saved", "daily_activity_settings_saved", "excel_imported", "excel_import_undone", "excel_import_removed", "excel_import_superseded", "achievements_changed", "achievements_reverted", "targets_changed", "shop_created", "shop_edited", "shop_deleted", "supervisor_created", "supervisor_edited", "supervisor_deleted", "supervisor_assignments_changed", "representatives_deleted", "representatives_hidden", "representatives_unhidden", "metric_deleted", "weight_profile_created", "weight_profile_edited", "weight_profile_deleted", "weight_profile_assignments_changed", "daily_closing_saved", "daily_closing_finalized", "daily_closing_reopened", "all_data_deleted", "user_created", "user_role_changed", "user_access_changed"]),
  occurredAt: z.string().datetime({ offset: true }),
  actor: z.object({
    id: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(120),
    username: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(255).optional(),
    role: z.enum(["admin", "editor", "viewer"]),
    shopIds: z.array(documentIdSchema).max(500).default([]),
  }).strict().refine(actor => Boolean(actor.username || actor.email), "An actor username is required."),
  summary: z.string().trim().min(1).max(500),
  shopIds: z.array(documentIdSchema).max(500),
  shopNames: z.array(z.string().trim().min(1).max(120)).max(500),
  metadata: z.record(z.union([z.string(), z.number().finite(), z.boolean()])).optional(),
}).strict();
