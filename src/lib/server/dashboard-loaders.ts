import "server-only";

import { cache } from "react";

import { fetchDashboardPeriods } from "@/app/dashboard-actions";
import { loadShopDirectory } from "@/lib/shop-directory";
import { getCurrentActor } from "@/lib/access";
import { measureServerOperation } from "@/lib/server/performance";

export const getDashboardPeriods = cache(fetchDashboardPeriods);
export const getShopDirectory = cache(async () => {
  const actor = await getCurrentActor();
  return measureServerOperation("shop.directory", () => loadShopDirectory(actor));
});
