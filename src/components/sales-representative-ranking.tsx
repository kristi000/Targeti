"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DashboardRepresentativeRow } from "@/lib/dashboard-types";

export function SalesRepresentativeRanking({ rows }: { rows: DashboardRepresentativeRow[] }) {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [shopId, setShopId] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const shops = useMemo(() => Array.from(
    new Map(rows.map(row => [row.shopId, { id: row.shopId, name: row.shopName }])).values(),
  ).sort((left, right) => left.name.localeCompare(right.name, locale)), [rows, locale]);

  const filteredRepresentatives = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return rows.filter(rep =>
      (shopId === "all" || rep.shopId === shopId)
      && (!normalizedQuery || `${rep.name} ${rep.shopName}`.toLocaleLowerCase(locale).includes(normalizedQuery))
    );
  }, [rows, query, shopId, locale]);
  const visibleRepresentatives = expanded ? filteredRepresentatives : filteredRepresentatives.slice(0, 5);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-slate-300 bg-slate-50 px-4 py-3">
        <div><h2 className="font-semibold text-slate-900">{t("topSalesReps")}</h2><p className="text-xs text-slate-500">Network leaderboard by shop</p></div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search representatives…" aria-label="Search representatives" className="h-9 bg-white pl-9" /></div>
          <select value={shopId} onChange={event => { setShopId(event.target.value); setExpanded(false); }} aria-label="Filter representatives by shop" className="h-9 min-w-0 max-w-32 rounded-md border bg-white px-2 text-sm">
            <option value="all">All shops</option>
            {shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y overflow-y-auto">
        {visibleRepresentatives.map(rep => {
          return <Link key={`${rep.shopId}-${rep.id}`} href={`/${locale}/shop/${rep.shopId}#representative-bonuses`} className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/50">
            <div className="flex min-w-0 items-center gap-3"><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold", rep.rank <= 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{rep.rank}</span><div className="min-w-0"><p className="truncate font-medium">{rep.name}</p><p className="truncate text-xs text-muted-foreground">{rep.shopName}</p></div></div>
            <div className="shrink-0 text-right"><p className="font-semibold tabular-nums">{rep.achievement.toFixed(1)}%</p><p className="text-xs text-muted-foreground">EOM: {rep.forecastAchievement === null ? "Final" : `${rep.forecastAchievement.toFixed(1)}%`}</p></div>
          </Link>;
        })}
        {!visibleRepresentatives.length && <div className="p-8 text-center text-sm text-muted-foreground">No representatives match these filters.</div>}
      </div>

      {filteredRepresentatives.length > 5 && <div className="flex items-center justify-between gap-3 border-t bg-slate-50 px-4 py-3"><p className="text-sm text-muted-foreground">Showing {visibleRepresentatives.length} of {filteredRepresentatives.length}</p><Button type="button" variant="outline" size="sm" onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}{expanded ? "Show top 5" : "View all"}</Button></div>}
    </div>
  );
}
