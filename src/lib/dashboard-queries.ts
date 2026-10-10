import { queryOptions } from "@tanstack/react-query";

import { fetchDashboardPage, fetchDashboardPeriods } from "@/app/dashboard-actions";
import { dashboardPageQueryKey, dashboardPeriodsQueryKey } from "@/lib/query-keys";
import type { DashboardView } from "@/lib/dashboard-navigation";

export function dashboardPeriodsQueryOptions() {
  return queryOptions({
    queryKey: dashboardPeriodsQueryKey,
    queryFn: fetchDashboardPeriods,
    staleTime: 60_000,
  });
}

export function dashboardPageQueryOptions(view: DashboardView & { month: string }) {
  const search = view.search.trim();
  return queryOptions({
    queryKey: dashboardPageQueryKey({ ...view, search }),
    queryFn: () => fetchDashboardPage({
      month: view.month,
      search,
      supervisorId: view.supervisorId,
      sortBy: view.sortBy,
      sortDirection: view.sortDescending ? "desc" : "asc",
    }),
    staleTime: 30_000,
  });
}
