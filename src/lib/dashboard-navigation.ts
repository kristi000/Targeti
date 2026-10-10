import { z } from "zod";

import { monthSchema, supervisorIdSchema } from "@/lib/persistence-schemas";
import type { DashboardSortKey } from "@/lib/dashboard-types";

const dashboardParametersSchema = z.object({
  month: monthSchema.optional().catch(undefined),
  q: z.string().max(120).default("").catch(""),
  supervisor: supervisorIdSchema.optional().catch(undefined),
  sort: z.enum(["shop", "achievement", "forecast", "revenue"]).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
});

export type DashboardView = {
  month?: string;
  search: string;
  supervisorId: string | null;
  sortBy: DashboardSortKey;
  sortDescending: boolean;
};

export function readDashboardView(parameters: { get: (name: string) => string | null }): DashboardView {
  const value = dashboardParametersSchema.parse(Object.fromEntries(
    ["month", "q", "supervisor", "sort", "dir"].map(name => [name, parameters.get(name) ?? undefined]),
  ));
  return {
    month: value.month,
    search: value.q,
    supervisorId: value.supervisor ?? null,
    sortBy: value.sort ?? "achievement",
    sortDescending: value.sort ? value.dir === "desc" : true,
  };
}

export function dashboardViewQuery(view: DashboardView): string {
  const parameters = new URLSearchParams();
  if (view.month) parameters.set("month", view.month);
  if (view.search.trim()) parameters.set("q", view.search);
  if (view.supervisorId) parameters.set("supervisor", view.supervisorId);
  parameters.set("sort", view.sortBy);
  parameters.set("dir", view.sortDescending ? "desc" : "asc");
  return parameters.toString();
}
