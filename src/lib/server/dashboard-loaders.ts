import "server-only";

import { cache } from "react";

import { fetchDashboardPeriods } from "@/app/dashboard-actions";
import { fetchPerformanceData } from "@/app/actions/shop-data";
import { loadShopDirectory } from "@/lib/shop-directory";
import { getCurrentActor } from "@/lib/access";

export const getDashboardPeriods = cache(fetchDashboardPeriods);
export const getShopPerformance = cache(fetchPerformanceData);
export const getShopDirectory = cache(async () => loadShopDirectory(await getCurrentActor()));
