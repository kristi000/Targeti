import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { useTranslations } from "use-intl";

import { useManager } from "@/components/manager/manager-provider";
import { EmptyState, ErrorState, LoadingState, Percent, SegmentedControl } from "@/components/manager/manager-ui";
import { displayShopName, metricShortLabel } from "@/components/dashboard-ui";
import { fetchInsightsPerformance } from "@/server/actions/insights";
import { dashboardPageQueryOptions } from "@/lib/dashboard-queries";
import type { InsightsView } from "@/lib/insights";
import { insightsPerformanceQueryKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

type Subject = "shops" | "representatives";
type Scope = "mine" | "all";
type Entry = { key: string; name: string; detail?: string; value: number | null; highlight: boolean };

export function ManagerRankings() {
  const t = useTranslations("Manager");
  const { shop, month } = useManager();
  const [view, setView] = useState<InsightsView>("month");
  const [subject, setSubject] = useState<Subject>("shops");
  const [scope, setScope] = useState<Scope>("mine");
  const [metricId, setMetricId] = useState<string>("total");

  const currentQuery = useQuery({
    ...dashboardPageQueryOptions({ month, search: "", supervisorId: null, sortBy: "achievement", sortDescending: true }),
    enabled: view === "month",
  });
  const periodQuery = useQuery({
    queryKey: insightsPerformanceQueryKey(month, view),
    queryFn: () => fetchInsightsPerformance({ month, view }),
    enabled: view !== "month",
    staleTime: 60_000,
  });
  const query = view === "month" ? currentQuery : periodQuery;

  const metricOptions = useMemo(() => {
    const first = currentQuery.data?.rows.find(row => row.metrics?.length)?.metrics ?? [];
    return first.map(metric => ({ id: metric.id, label: metricShortLabel(metric) }));
  }, [currentQuery.data]);
  const activeMetric = view === "month" && metricOptions.some(option => option.id === metricId) ? metricId : "total";

  const entries = useMemo<Entry[]>(() => {
    const ownShopId = shop?.id;
    const valueOf = (total: number, metrics?: Array<{ id: string; achievement: number }>) =>
      activeMetric === "total" ? total : metrics?.find(metric => metric.id === activeMetric)?.achievement ?? null;
    let list: Entry[] = [];
    if (view === "month" && currentQuery.data) {
      list = subject === "shops"
        ? currentQuery.data.rows.filter(row => row.hasData).map(row => ({
          key: row.shop.id, name: displayShopName(row.shop.name), value: valueOf(row.totalAchievement, row.metrics), highlight: row.shop.id === ownShopId,
        }))
        : currentQuery.data.representativeRows
          .filter(row => scope === "all" || row.shopId === ownShopId)
          .map(row => ({
            key: `${row.shopId}:${row.id}`, name: row.name, detail: scope === "all" ? displayShopName(row.shopName) : undefined,
            value: valueOf(row.achievement, row.metrics), highlight: scope === "all" && row.shopId === ownShopId,
          }));
    } else if (view !== "month" && periodQuery.data) {
      list = subject === "shops"
        ? periodQuery.data.shopRows.map(row => ({ key: row.shopId, name: displayShopName(row.name), value: row.achievement, highlight: row.shopId === ownShopId }))
        : periodQuery.data.representativeRows
          .filter(row => scope === "all" || row.shopId === ownShopId)
          .map(row => ({
            key: `${row.shopId}:${row.representativeId}`, name: row.name, detail: scope === "all" ? displayShopName(row.shopName) : undefined,
            value: row.achievement, highlight: scope === "all" && row.shopId === ownShopId,
          }));
    }
    return list
      .filter(entry => entry.value !== null && Number.isFinite(entry.value))
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0) || left.name.localeCompare(right.name));
  }, [view, subject, scope, activeMetric, currentQuery.data, periodQuery.data, shop?.id]);

  const ownPosition = entries.findIndex(entry => entry.highlight) + 1;

  return (
    <>
      <SegmentedControl
        label={t("rankings.period")}
        value={view}
        onChange={setView}
        options={[
          { value: "month", label: t("rankings.current") },
          { value: "quarter", label: t("rankings.quarterly") },
          { value: "year", label: t("rankings.yearly") },
        ]}
      />
      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <SegmentedControl
            label={t("rankings.subject")}
            value={subject}
            onChange={setSubject}
            options={[{ value: "shops", label: t("rankings.shops") }, { value: "representatives", label: t("rankings.representatives") }]}
          />
        </div>
        {subject === "representatives" && (
          <div className="flex-1">
            <SegmentedControl
              label={t("rankings.scope")}
              value={scope}
              onChange={setScope}
              options={[{ value: "mine", label: shop ? displayShopName(shop.name) : t("rankings.myShop") }, { value: "all", label: t("rankings.allShops") }]}
            />
          </div>
        )}
      </div>

      {view === "month" && metricOptions.length > 0 && (
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("rankings.rankBy")}>
          {[{ id: "total", label: t("rankings.totalScore") }, ...metricOptions].map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={activeMetric === option.id}
              onClick={() => setMetricId(option.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeMetric === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {query.isPending ? <LoadingState />
          : query.isError ? <ErrorState onRetry={() => void query.refetch()} />
            : entries.length === 0 ? <EmptyState>{t("rankings.empty")}</EmptyState>
              : <>
                {subject === "shops" && ownPosition > 0 && shop && (
                  <p className="mb-3 text-center text-sm text-muted-foreground">
                    {t("rankings.yourPosition", { shop: displayShopName(shop.name), rank: ownPosition, total: entries.length })}
                  </p>
                )}
                <Podium entries={entries.slice(0, 3)} />
                <ol className="glass mt-3 divide-y divide-border/60 rounded-2xl" start={4}>
                  {entries.slice(3).map((entry, index) => (
                    <li key={entry.key} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", entry.highlight && "bg-primary/[0.07]")}>
                      <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 4}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", entry.highlight && "font-semibold text-primary")}>{entry.name}</span>
                        {entry.detail && <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span>}
                      </span>
                      <Percent value={entry.value} toneValue={neutralTone(entry.value)} />
                    </li>
                  ))}
                </ol>
              </>}
      </div>
    </>
  );
}

/** Mid-month results are naturally low, so only results at or above target are coloured. */
function neutralTone(value: number | null) {
  return value !== null && value >= 100 ? value : null;
}

function Podium({ entries }: { entries: Entry[] }) {
  const order = [entries[1], entries[0], entries[2]];
  const heights = ["h-16", "h-24", "h-12"];
  const places = [2, 1, 3];
  return (
    <div className="flex items-end justify-center gap-2">
      {order.map((entry, index) => entry ? (
        <div key={entry.key} className="flex min-w-0 flex-1 flex-col items-center text-center">
          {places[index] === 1 && <Crown aria-hidden="true" className="mb-1 h-5 w-5 text-amber-500" />}
          <p className={cn("w-full truncate text-xs", entry.highlight ? "font-semibold text-primary" : "font-medium")}>{entry.name}</p>
          {entry.detail && <p className="w-full truncate text-[11px] text-muted-foreground">{entry.detail}</p>}
          <div className={cn(
            "mt-1 flex w-full flex-col items-center justify-start rounded-t-xl pt-2",
            heights[index],
            places[index] === 1 ? "bg-primary/15" : "bg-foreground/[0.06]",
          )}>
            <span className="text-sm font-bold tabular-nums">{places[index]}</span>
            <Percent value={entry.value} toneValue={neutralTone(entry.value)} className="text-xs" />
          </div>
        </div>
      ) : <div key={`empty-${index}`} className="flex-1" />)}
    </div>
  );
}
