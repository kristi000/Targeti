import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { toFirestoreData } from "@/app/actions/shared";
import { bonusSnapshotSchema, monthSchema, quarterlyBonusSnapshotSchema, shopIdSchema, shopSchema } from "@/lib/persistence-schemas";
import { getQuarterKey, type Shop } from "@/lib/types";

export const importChangeIdentitySchema = z.object({
  shopId: shopIdSchema,
  shopName: z.string().trim().min(1).max(120),
  performanceId: shopIdSchema,
}).strict();

const previousPayrollSnapshots = {
  previousBonusSnapshot: bonusSnapshotSchema.nullable().optional(),
  previousQuarterlyBonusSnapshot: quarterlyBonusSnapshotSchema.nullable().optional(),
};

export const legacyImportChangeSchema = importChangeIdentitySchema.extend({
  previousShop: shopSchema.nullable(),
  importedShop: shopSchema,
  ...previousPayrollSnapshots,
}).strict();

const compactPreviousShopSchema = shopSchema.extend({
  monthlyData: shopSchema.shape.monthlyData.refine(
    value => value === undefined || Object.keys(value).length <= 1,
    "An import snapshot can contain only its reporting month.",
  ),
  quarterSettings: shopSchema.shape.quarterSettings.refine(
    value => value === undefined || Object.keys(value).length <= 1,
    "An import snapshot can contain only its reporting quarter.",
  ),
});

const compactImportChangeSchema = importChangeIdentitySchema.extend({
  schemaVersion: z.literal(2),
  month: monthSchema,
  previousShop: compactPreviousShopSchema.nullable(),
  importedShopHash: z.string().regex(/^[a-f0-9]{64}$/),
  ...previousPayrollSnapshots,
}).strict().superRefine((change, context) => {
  if (change.previousShop && change.previousShop.id !== change.shopId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousShop", "id"],
      message: "The previous shop ID does not match the import shop.",
    });
  }
  if (Object.keys(change.previousShop?.monthlyData ?? {}).some(month => month !== change.month)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousShop", "monthlyData"],
      message: "An import snapshot contains a different reporting month.",
    });
  }
  if (Object.keys(change.previousShop?.quarterSettings ?? {}).some(quarter => quarter !== getQuarterKey(change.month))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["previousShop", "quarterSettings"],
      message: "An import snapshot contains a different reporting quarter.",
    });
  }
});

export const storedImportChangeSchema = z.union([legacyImportChangeSchema, compactImportChangeSchema]);

type StoredImportChange = z.infer<typeof storedImportChangeSchema>;
type ImportChangeInput = z.infer<typeof importChangeIdentitySchema> & {
  previousShop: Shop | null;
  importedShop: Shop;
};

function canonicalOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalOrder);
  if (value && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map(key => [key, canonicalOrder(fields[key])]));
  }
  return value;
}

const canonicalValue = (value: unknown) => JSON.stringify(canonicalOrder(toFirestoreData(value)));
const shopHash = (shop: Shop) => createHash("sha256").update(canonicalValue(shop)).digest("hex");

function selectedPeriod<T>(periods: Record<string, T>, selected: string): Record<string, T> {
  return Object.hasOwn(periods, selected) ? { [selected]: periods[selected] } : {};
}

function otherPeriods<T>(periods: Record<string, T> | undefined, selected: string): Record<string, T> {
  return Object.fromEntries(Object.entries(periods ?? {}).filter(([period]) => period !== selected));
}

export function createImportChangeSnapshot(change: ImportChangeInput, month: string) {
  const validMonth = monthSchema.parse(month);
  const quarter = getQuarterKey(validMonth);
  const previous = change.previousShop ? toFirestoreData(change.previousShop) : null;
  const previousShop = previous ? {
    ...previous,
    ...(previous.monthlyData !== undefined && { monthlyData: selectedPeriod(previous.monthlyData, validMonth) }),
    ...(previous.quarterSettings !== undefined && { quarterSettings: selectedPeriod(previous.quarterSettings, quarter) }),
  } : null;

  return compactImportChangeSchema.parse({
    schemaVersion: 2,
    month: validMonth,
    shopId: change.shopId,
    shopName: change.shopName,
    performanceId: change.performanceId,
    previousShop,
    importedShopHash: shopHash(change.importedShop),
  });
}

export function importChangesOnlySelectedPeriod(previous: Shop | null, next: Shop, month: string): boolean {
  const quarter = getQuarterKey(month);
  return canonicalValue(otherPeriods(previous?.monthlyData, month)) === canonicalValue(otherPeriods(next.monthlyData, month))
    && canonicalValue(otherPeriods(previous?.quarterSettings, quarter)) === canonicalValue(otherPeriods(next.quarterSettings, quarter));
}

export function isImportShopUnchanged(change: StoredImportChange, currentShop: Shop): boolean {
  return "schemaVersion" in change
    ? shopHash(currentShop) === change.importedShopHash
    : canonicalValue(currentShop) === canonicalValue(change.importedShop);
}

function restorePeriods<T>(
  previous: Record<string, T> | undefined,
  current: Record<string, T> | undefined,
  selected: string,
): Record<string, T> | undefined {
  const restored = { ...otherPeriods(current, selected), ...previous };
  // A missing map and an explicitly empty map have different persisted shapes.
  return previous === undefined && Object.keys(restored).length === 0 ? undefined : restored;
}

export function restoreImportShop(change: StoredImportChange, currentShop: Shop): Shop | null {
  if (!change.previousShop) return null;
  if (!("schemaVersion" in change)) return change.previousShop as Shop;

  const previous = change.previousShop as Shop;
  const { monthlyData: previousMonthlyData, quarterSettings: previousQuarterSettings, ...defaults } = previous;
  const monthlyData = restorePeriods(previousMonthlyData, currentShop.monthlyData, change.month);
  const quarterSettings = restorePeriods(previousQuarterSettings, currentShop.quarterSettings, getQuarterKey(change.month));
  return {
    ...defaults,
    ...(monthlyData !== undefined && { monthlyData }),
    ...(quarterSettings !== undefined && { quarterSettings }),
  } as Shop;
}
