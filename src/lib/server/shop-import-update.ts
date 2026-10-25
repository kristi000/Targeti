import "server-only";

import { deleteField } from "@/lib/firebase-admin";
import { stableValue, toFirestoreData } from "@/app/actions/shared";
import type { Shop } from "@/lib/types";

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function getShopImportUpdate(previousShop: Shop, nextShop: Shop): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  const previous = toFirestoreData(previousShop) as unknown as Record<string, unknown>;
  const next = toFirestoreData(nextShop) as unknown as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (key === "id" || sameValue(previous[key], next[key])) continue;
    if (!Object.hasOwn(next, key)) {
      update[key] = deleteField();
      continue;
    }

    const previousValue = previous[key];
    const nextValue = next[key];
    if (
      (key === "monthlyData" || key === "quarterSettings")
      && isMap(previousValue)
      && isMap(nextValue)
      && Object.keys(nextValue).length > 0
    ) {
      for (const period of new Set([...Object.keys(previousValue), ...Object.keys(nextValue)])) {
        if (sameValue(previousValue[period], nextValue[period])) continue;
        // Period keys come from the validated month/quarter schemas and contain no dots.
        update[`${key}.${period}`] = Object.hasOwn(nextValue, period) ? nextValue[period] : deleteField();
      }
    } else {
      update[key] = nextValue;
    }
  }

  // Identical reimports still need a shop write to enforce the update-time precondition.
  return Object.keys(update).length ? update : { name: nextShop.name };
}
