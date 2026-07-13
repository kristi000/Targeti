"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { getDaysInMonth } from "date-fns";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  Gauge,
  Store,
} from "lucide-react";

import { Header } from "@/components/header";
import { SidebarActions } from "@/components/sidebar-actions";
import { useShop } from "@/components/shop-provider";
import { SalesRepresentativeRanking } from "./sales-representative-ranking";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn, calculateTotalAchievement } from "@/lib/utils";
import { getPerformanceDatasetId, getPerformanceShopActuals, getShopMetrics } from "@/lib/types";

const periods = ["Today", "This week", "This month", "3 months"] as const;
type Period = (typeof periods)[number];

function getHealth(achievement: number) {
  if (achievement >= 100) return { label: "On target", color: "bg-emerald-500", text: "text-emerald-700" };
  if (achievement >= 80) return { label: "At risk", color: "bg-amber-500", text: "text-amber-700" };
  return { label: "Behind", color: "bg-rose-500", text: "text-rose-700" };
}

export function DashboardClient() {
  const { shops, allPerformanceData, allMonthlyTargets, loading, selectedDatasetId, setSelectedDatasetId } = useShop();
  const [period, setPeriod] = useState<Period>("This month");
  const t = useTranslations("Dashboard");
  const locale = useLocale();

  const datasets = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; date: string; importedAt: string }>();
    Object.values(allPerformanceData).flat().forEach(entry => {
      const id = getPerformanceDatasetId(entry);
      const existing = byId.get(id);
      const importedAt = entry.importedAt ?? entry.date;
      if (!existing || importedAt > existing.importedAt) {
        byId.set(id, { id, name: entry.importName ?? `Excel report ${entry.date}`, date: entry.date, importedAt });
      }
    });
    return [...byId.values()].sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }, [allPerformanceData]);
  const activeDatasetId = datasets.some(dataset => dataset.id === selectedDatasetId) ? selectedDatasetId : datasets[0]?.id ?? "";

  const shopPerformances = useMemo(() => {
    const today = new Date();
    const daysInMonth = getDaysInMonth(today);
    const dayOfMonth = Math.max(today.getDate(), 1);

    return shops.map((shop) => {
      const performanceData = (allPerformanceData[shop.id] || []).filter(entry => getPerformanceDatasetId(entry) === activeDatasetId);
      const monthlyTargets = performanceData[0]?.targets ?? allMonthlyTargets[shop.id];
      if (!monthlyTargets || performanceData.length === 0) {
        return { shop, revenue: performanceData[0]?.revenue ?? shop.revenue ?? 0, totalAchievement: 0, forecastAchievement: 0 };
      }

      const metrics = getShopMetrics(shop, monthlyTargets);
      const monthlyTotals = getPerformanceShopActuals(performanceData, metrics);
      const totalAchievement = calculateTotalAchievement(monthlyTotals, monthlyTargets, shop.metricSettings);

      return {
        shop,
        revenue: performanceData[0]?.revenue ?? shop.revenue ?? 0,
        totalAchievement,
        forecastAchievement: (totalAchievement / dayOfMonth) * daysInMonth,
      };
    }).sort((a, b) => b.totalAchievement - a.totalAchievement);
  }, [shops, allPerformanceData, allMonthlyTargets, activeDatasetId]);

  const summary = useMemo(() => {
    const count = shopPerformances.length;
    const average = count ? shopPerformances.reduce((sum, item) => sum + item.totalAchievement, 0) / count : 0;
    const forecast = count ? shopPerformances.reduce((sum, item) => sum + item.forecastAchievement, 0) / count : 0;
    const revenue = shopPerformances.reduce((sum, item) => sum + item.revenue, 0);
    return { average, forecast, revenue };
  }, [shopPerformances, shops]);

  if (loading) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex flex-1 items-center justify-center text-muted-foreground">Loading dashboard…</div></div>;
  }

  if (shops.length === 0) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex flex-1 flex-col items-center justify-center gap-3"><p className="text-muted-foreground">Add a shop to start tracking performance.</p><SidebarActions /></div></div>;
  }

  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <Header title={t("title")} />
      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2"><h2 className="text-2xl font-semibold tracking-tight">Network overview</h2><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Preview</span></div>
              <p className="mt-1 text-sm text-muted-foreground">Performance across all locations</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {datasets.length > 0 && <label className="grid gap-1 text-xs text-muted-foreground">
                Excel data
                <select className="h-9 max-w-64 rounded-md border bg-background px-3 text-sm text-foreground" value={activeDatasetId} onChange={event => setSelectedDatasetId(event.target.value)}>
                  {datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.date}</option>)}
                </select>
              </label>}
              <div className="flex rounded-lg border bg-background p-1 shadow-sm" aria-label="Reporting period">
                {periods.map((item) => <Button key={item} type="button" size="sm" variant={period === item ? "default" : "ghost"} className="h-8 px-3" onClick={() => setPeriod(item)}>{item}</Button>)}
              </div>
              <SidebarActions />
            </div>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Overall achievement" value={`${summary.average.toFixed(1)}%`} detail="Network average" icon={Gauge} trend={summary.average >= 100 ? "On target" : `${(100 - summary.average).toFixed(1)} pts to target`} positive={summary.average >= 100} />
            <SummaryCard label="EOM forecast" value={`${summary.forecast.toFixed(1)}%`} detail="Based on current pace" icon={ArrowUpRight} trend={`${(summary.forecast - summary.average).toFixed(1)} pts projected`} positive={summary.forecast >= summary.average} />
            <SummaryCard label="Total revenue" value={currency.format(summary.revenue)} detail={period} icon={CircleDollarSign} />
            <SummaryCard label="Active shops" value={String(shops.length)} detail="Reporting locations" icon={Building2} trend={`${shopPerformances.filter((item) => item.totalAchievement >= 100).length} on target`} positive />
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-300 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-700 p-1.5 text-white"><Store className="h-4 w-4" /></span>
                <div><h3 className="font-semibold text-slate-900">All shops</h3><p className="text-xs text-slate-500">Network performance worksheet · {shopPerformances.length} rows</p></div>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600">
                <span><span className="mr-1.5 inline-block h-2.5 w-2.5 bg-emerald-500" />On target</span>
                <span><span className="mr-1.5 inline-block h-2.5 w-2.5 bg-amber-400" />At risk</span>
                <span><span className="mr-1.5 inline-block h-2.5 w-2.5 bg-rose-500" />Behind</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
                    <th className="w-12 border-b border-r border-slate-300 px-2 py-2 text-center">#</th>
                    <th className="border-b border-r border-slate-300 px-3 py-2 text-left">Shop</th>
                    <th className="w-32 border-b border-r border-slate-300 px-3 py-2 text-left">Status</th>
                    <th className="w-36 border-b border-r border-slate-300 px-3 py-2 text-right">Achievement</th>
                    <th className="w-36 border-b border-r border-slate-300 px-3 py-2 text-right">EOM forecast</th>
                    <th className="w-44 border-b border-r border-slate-300 px-3 py-2 text-right">Revenue</th>
                    <th className="w-56 border-b border-r border-slate-300 px-3 py-2 text-left">Target progress</th>
                    <th className="w-14 border-b border-slate-300 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shopPerformances.map(({ shop, totalAchievement, forecastAchievement }, index) => {
                    const health = getHealth(totalAchievement);
                    return (
                      <tr key={shop.id} className="group bg-white even:bg-slate-50/70 hover:bg-emerald-50/70">
                        <td className="border-b border-r border-slate-200 bg-slate-100 px-2 py-3 text-center font-mono text-xs text-slate-500">{index + 1}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-3 font-medium text-slate-900">{shop.name}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-3"><span className={cn("inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-semibold", health.text, totalAchievement >= 100 ? "bg-emerald-100" : totalAchievement >= 80 ? "bg-amber-100" : "bg-rose-100")}><span className={cn("h-2 w-2 rounded-full", health.color)} />{health.label}</span></td>
                        <td className="border-b border-r border-slate-200 px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{totalAchievement.toFixed(1)}%</td>
                        <td className="border-b border-r border-slate-200 px-3 py-3 text-right tabular-nums text-slate-700">{forecastAchievement.toFixed(1)}%</td>
                        <td className="border-b border-r border-slate-200 px-3 py-3 text-right tabular-nums text-slate-700">{shop.revenue === undefined ? "—" : currency.format(shop.revenue)}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-3"><div className="flex items-center gap-3"><Progress value={Math.min(totalAchievement, 100)} className="h-2 flex-1 rounded-sm bg-slate-200" /><span className="w-10 text-right font-mono text-xs text-slate-500">100%</span></div></td>
                        <td className="border-b border-slate-200 px-2 py-3 text-center"><Link href={`/${locale}/shop/${shop.id}`} aria-label={`Open ${shop.name}`} className="inline-flex rounded p-1 text-slate-400 hover:bg-white hover:text-primary"><ArrowRight className="h-4 w-4" /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-200 font-semibold text-slate-800">
                    <td className="border-r border-t border-slate-300 px-2 py-2" />
                    <td className="border-r border-t border-slate-300 px-3 py-2" colSpan={2}>NETWORK TOTAL / AVERAGE</td>
                    <td className="border-r border-t border-slate-300 px-3 py-2 text-right tabular-nums">{summary.average.toFixed(1)}%</td>
                    <td className="border-r border-t border-slate-300 px-3 py-2 text-right tabular-nums">{summary.forecast.toFixed(1)}%</td>
                    <td className="border-r border-t border-slate-300 px-3 py-2 text-right tabular-nums">{currency.format(summary.revenue)}</td>
                    <td className="border-t border-slate-300 px-3 py-2" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="rounded-xl border bg-background p-5 shadow-sm"><SalesRepresentativeRanking /></section>
        </div>
      </main>
    </div>
  );
}

type SummaryCardProps = { label: string; value: string; detail: string; icon: typeof Gauge; trend?: string; positive?: boolean };

function SummaryCard({ label, value, detail, icon: Icon, trend, positive }: SummaryCardProps) {
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p></div><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span></div><div className="mt-3 flex items-center gap-1.5 text-xs"><span className="text-muted-foreground">{detail}</span>{trend && <><span className="text-muted-foreground">·</span><span className={positive ? "text-emerald-600" : "text-amber-600"}><TrendIcon className="mr-0.5 inline h-3.5 w-3.5" />{trend}</span></>}</div></CardContent></Card>;
}
