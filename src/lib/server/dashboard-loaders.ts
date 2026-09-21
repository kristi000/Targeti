import "server-only";

import { cache } from "react";

import { fetchDashboardPeriods } from "@/app/dashboard-actions";
import { loadShopDirectory } from "@/lib/shop-directory";
import { getCurrentActor } from "@/lib/access";

export const getDashboardPeriods = cache(fetchDashboardPeriods);
export const getShopDirectory = cache(async () => loadShopDirectory(await getCurrentActor()));
