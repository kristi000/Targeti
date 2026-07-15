"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  Search,
  Store,
} from "lucide-react";

import { Header } from "@/components/header";
import { SidebarActions } from "@/components/sidebar-actions";
import { useShop } from "@/components/shop-provider";
import { SalesRepresentativeRanking } from "./sales-representative-ranking";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fetchDashboardPage, type DashboardCursor, type DashboardRow } from "@/app/actions";
import { getOverviewPerformanceData } from "@/lib/types";

type ShopPerformanceRow = DashboardRow;

const shopColumns: ColumnDef<ShopPerformanceRow>[] = [
  { id: "shop", accessorFn: row => row.shop.name },
  { id: "achievement", accessorKey: "totalAchievement" },
  { id: "forecast", accessorKey: "forecastAchievement" },
  { id: "revenue", accessorKey: "revenue" },
];

export function DashboardClient() {
  const { shops, allPerformanceData, loading, setSelectedDatasetId } = useShop();
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shopSearch, setShopSearch] = useState(searchParams.get("q") ?? "");
  const [selectedMonth, setSelectedMonth] = useState(searchParams.get("month") ?? "");
  const [sorting, setSorting] = useState<SortingState>([{ id: "shop", desc: searchParams.get("dir") === "desc" }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: Math.max(Number(searchParams.get("page") ?? 1) - 1, 0), pageSize: [10, 20, 50].includes(Number(searchParams.get("size"))) ? Number(searchParams.get("size")) : 10 });
  const initialCursor = searchParams.get("afterName") && searchParams.get("afterId") ? { name: searchParams.get("afterName")!, id: searchParams.get("afterId")! } : null;
  const [cursor, setCursor] = useState<DashboardCursor | null>(initialCursor);
  const [cursorHistory, setCursorHistory] = useState<Array<DashboardCursor | null>>(() => Array.from({ length: Math.max(Number(searchParams.get("page") ?? 1), 1) }, (_, index) => index === Math.max(Number(searchParams.get("page") ?? 1) - 1, 0) ? initialCursor : null));
  const deferredSearch = useDeferredValue(shopSearch.trim());

  const datasets = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; date: string; importedAt: string }>();
    Object.values(allPerformanceData).flatMap(getOverviewPerformanceData).forEach(entry => {
      const id = entry.date.slice(0, 7);
      const existing = byId.get(id);
      const importedAt = entry.importedAt ?? entry.date;
      if (!existing || importedAt > existing.importedAt) {
        byId.set(id, { id, name: id, date: entry.date, importedAt });
      }
    });
    return [...byId.values()].sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }, [allPerformanceData]);
  const activeDatasetId = datasets.some(dataset => dataset.id === selectedMonth) ? selectedMonth : datasets[0]?.id ?? new Date().toISOString().slice(0, 7);

  const pageQuery = useQuery({
    queryKey: ["firestore-shop-performance-page", activeDatasetId, deferredSearch, pagination.pageSize, cursor, sorting[0]?.desc],
    queryFn: () => fetchDashboardPage({ month: activeDatasetId, search: deferredSearch, pageSize: pagination.pageSize, cursor, sortDirection: sorting[0]?.desc ? "desc" : "asc" }),
    placeholderData: keepPreviousData,
  });

  const shopPerformances = pageQuery.data?.rows ?? [];

  const summary = useMemo(() => {
    const reportingEntries = shopPerformances.filter(item => item.hasData);
    const average = reportingEntries.length ? reportingEntries.reduce((sum, item) => sum + item.totalAchievement, 0) / reportingEntries.length : 0;
    const forecastEntries = shopPerformances.filter(item => item.forecastAchievement !== null);
    const forecast = forecastEntries.length ? forecastEntries.reduce((sum, item) => sum + (item.forecastAchievement ?? 0), 0) / forecastEntries.length : null;
    return {
      average,
      forecast,
      revenue: shopPerformances.reduce((sum, item) => sum + item.revenue, 0),
      previousAverage: reportingEntries.some(item => item.previousAchievement !== null) ? reportingEntries.reduce((sum, item) => sum + (item.previousAchievement ?? 0), 0) / reportingEntries.filter(item => item.previousAchievement !== null).length : null,
      previousRevenue: shopPerformances.some(item => item.previousRevenue !== null) ? shopPerformances.reduce((sum, item) => sum + (item.previousRevenue ?? 0), 0) : null,
      allFinal: reportingEntries.length > 0 && reportingEntries.every(item => item.isFinal),
    };
  }, [shopPerformances]);

  const table = useReactTable({
    data: pageQuery.data?.rows ?? [],
    columns: shopColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    rowCount: pageQuery.data?.total ?? 0,
    state: { pagination, sorting },
    onPaginationChange: updater => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      if (next.pageSize !== pagination.pageSize) {
        setCursor(null); setCursorHistory([null]); setPagination({ pageIndex: 0, pageSize: next.pageSize }); return;
      }
      if (next.pageIndex > pagination.pageIndex) {
        const nextCursor = pageQuery.data?.nextCursor;
        if (!nextCursor) return;
        setCursorHistory(current => { const copy = [...current]; copy[next.pageIndex] = nextCursor; return copy; });
        setCursor(nextCursor);
      } else {
        setCursor(cursorHistory[next.pageIndex] ?? null);
      }
      setPagination(next);
    },
    onSortingChange: updater => {
      setSorting(updater);
      setCursor(null); setCursorHistory([null]); setPagination(current => ({ ...current, pageIndex: 0 }));
    },
  });

  const updateSearch = (value: string) => {
    setShopSearch(value);
    setCursor(null); setCursorHistory([null]); setPagination(current => ({ ...current, pageIndex: 0 }));
  };

  useEffect(() => {
    const parameters = new URLSearchParams();
    if (activeDatasetId) parameters.set("month", activeDatasetId);
    if (shopSearch.trim()) parameters.set("q", shopSearch.trim());
    if (pagination.pageIndex) parameters.set("page", String(pagination.pageIndex + 1));
    if (pagination.pageSize !== 10) parameters.set("size", String(pagination.pageSize));
    if (sorting[0]?.desc) parameters.set("dir", "desc");
    if (cursor) { parameters.set("afterName", cursor.name); parameters.set("afterId", cursor.id); }
    router.replace(`${pathname}?${parameters.toString()}`, { scroll: false });
    setSelectedDatasetId(activeDatasetId);
  }, [activeDatasetId, shopSearch, pagination.pageIndex, pagination.pageSize, sorting, cursor, pathname, router, setSelectedDatasetId]);

  if (loading) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex flex-1 items-center justify-center text-muted-foreground">Loading dashboard…</div></div>;
  }

  if (shops.length === 0) {
    return <div className="flex h-full flex-col"><Header title={t("title")} /><div className="flex flex-1 flex-col items-center justify-center gap-3"><p className="text-muted-foreground">Add a shop to start tracking performance.</p><SidebarActions /></div></div>;
  }

  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  const visibleRows = table.getRowModel().rows;
  const resultCount = pageQuery.data?.total ?? 0;

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
            <div className="flex flex-wrap items-end gap-2">
              {datasets.length > 0 && <label className="grid gap-1 text-xs text-muted-foreground">
                Reporting month
                <select className="h-9 max-w-64 rounded-md border bg-background px-3 text-sm text-foreground" value={activeDatasetId} onChange={event => { setSelectedMonth(event.target.value); setCursor(null); setCursorHistory([null]); setPagination(current => ({ ...current, pageIndex: 0 })); }}>
                  {datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                </select>
              </label>}
              <SidebarActions />
            </div>
          </div>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Overall achievement" value={`${summary.average.toFixed(1)}%`} detail="Visible locations" icon={Gauge} trend={summary.previousAverage === null ? undefined : `${formatChange(summary.average - summary.previousAverage, " pts")} vs previous month`} positive={summary.previousAverage !== null && summary.average >= summary.previousAverage} />
            <SummaryCard label="EOM forecast" value={summary.allFinal ? "Final" : summary.forecast === null ? "—" : `${summary.forecast.toFixed(1)}%`} detail={summary.allFinal ? "Completed month" : "Based on current pace"} icon={ArrowUpRight} trend={summary.forecast === null ? undefined : `${(summary.forecast - summary.average).toFixed(1)} pts projected`} positive={summary.forecast !== null && summary.forecast >= summary.average} />
            <SummaryCard label="Total revenue" value={currency.format(summary.revenue)} detail="Visible locations" icon={CircleDollarSign} trend={summary.previousRevenue === null ? undefined : `${formatChange(summary.revenue - summary.previousRevenue, " ALL")} vs previous month`} positive={summary.previousRevenue !== null && summary.revenue >= summary.previousRevenue} />
            <SummaryCard label="Active shops" value={String(shops.length)} detail="Reporting locations" icon={Building2} trend={`${shopPerformances.filter(item => item.totalAchievement >= 100).length} at or above 100%`} positive />
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-300 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-700 p-1.5 text-white"><Store className="h-4 w-4" /></span>
                <div><h3 className="font-semibold text-slate-900">All shops</h3><p className="text-xs text-slate-500">{resultCount} matching locations</p></div>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={shopSearch} onChange={event => updateSearch(event.target.value)} placeholder="Search shops…" aria-label="Search shops" className="h-9 bg-white pl-9" />
              </div>
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[780px] border-collapse text-sm">
                <thead><tr className="bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  <th className="w-12 border-b border-r border-slate-300 px-2 py-2 text-center">#</th>
                  <SortableHeader table={table} columnId="shop" label="Shop" align="left" />
                  <th className="border-b border-r border-slate-300 px-3 py-2 text-right">Achievement</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2 text-right">EOM forecast</th>
                  <th className="border-b border-r border-slate-300 px-3 py-2 text-right">Revenue</th>
                  <th className="w-64 border-b border-r border-slate-300 px-3 py-2 text-left">Target progress</th>
                  <th className="w-14 border-b border-slate-300 px-2 py-2"><span className="sr-only">Open shop</span></th>
                </tr></thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => {
                    const item = row.original;
                    const destination = `/${locale}/shop/${item.shop.id}`;
                    return <tr key={item.shop.id} tabIndex={0} aria-label={`Open ${item.shop.name}`} className="cursor-pointer bg-white even:bg-slate-50/70 hover:bg-emerald-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onClick={() => router.push(destination)} onKeyDown={event => { if (event.key === "Enter") router.push(destination); }}>
                      <td className="border-b border-r border-slate-200 bg-slate-100 px-2 py-3 text-center font-mono text-xs text-slate-500">{pagination.pageIndex * pagination.pageSize + rowIndex + 1}</td>
                      <th scope="row" className="border-b border-r border-slate-200 px-3 py-3 text-left font-medium text-slate-900">{item.shop.name}</th>
                      <td className="border-b border-r border-slate-200 px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{item.hasData ? <div>{item.totalAchievement.toFixed(1)}%<TrendIndicator change={item.previousAchievement === null ? null : item.totalAchievement - item.previousAchievement} suffix=" pts" /></div> : "—"}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-3 text-right tabular-nums text-slate-700">{item.isFinal ? <span className="font-medium text-slate-900">Final</span> : item.forecastAchievement === null ? "—" : `${item.forecastAchievement.toFixed(1)}%`}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-3 text-right tabular-nums text-slate-700">{item.hasData ? <div>{currency.format(item.revenue)}<TrendIndicator change={item.previousRevenue === null ? null : item.revenue - item.previousRevenue} /></div> : "—"}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-3">{item.hasData ? <div className="flex items-center gap-3"><Progress value={item.totalAchievement} max={120} markerValue={100} className="h-2 flex-1 rounded-sm bg-slate-200" /><span className="w-12 text-right font-mono text-xs font-medium text-slate-600">{item.totalAchievement.toFixed(0)}%</span></div> : <span className="text-xs text-slate-500">Not imported</span>}</td>
                      <td className="border-b border-slate-200 px-2 py-3 text-center text-slate-400"><ArrowRight className="mx-auto h-4 w-4" /></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {visibleRows.map(row => {
                const item = row.original;
                return <Link key={item.shop.id} href={`/${locale}/shop/${item.shop.id}`} className="block space-y-3 p-4 hover:bg-emerald-50/70">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{item.shop.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.hasData ? currency.format(item.revenue) : "No imported data"}</p></div><ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /></div>
                  {item.hasData && <><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Achievement</p><p className="font-semibold tabular-nums">{item.totalAchievement.toFixed(1)}%</p></div><div><p className="text-xs text-slate-500">EOM forecast</p><p className="font-medium tabular-nums">{item.isFinal ? "Final" : item.forecastAchievement === null ? "—" : `${item.forecastAchievement.toFixed(1)}%`}</p></div></div><Progress value={item.totalAchievement} max={120} markerValue={100} className="h-2 bg-slate-200" /></>}
                </Link>;
              })}
            </div>

            {visibleRows.length === 0 && <div className="px-4 py-12 text-center text-sm text-slate-500">No shops match your search.</div>}
            <TablePagination table={table} resultCount={resultCount} />
          </section>

          <section className="rounded-xl border bg-background p-5 shadow-sm"><SalesRepresentativeRanking /></section>
        </div>
      </main>
    </div>
  );
}

type DashboardTable = ReturnType<typeof useReactTable<ShopPerformanceRow>>;

function SortableHeader({ table, columnId, label, align = "right" }: { table: DashboardTable; columnId: string; label: string; align?: "left" | "right" }) {
  const column = table.getColumn(columnId);
  const direction = column?.getIsSorted();
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return <th className={cn("border-b border-r border-slate-300 px-3 py-2", align === "left" ? "text-left" : "text-right")}><button type="button" className={cn("inline-flex w-full items-center gap-1", align === "left" ? "justify-start" : "justify-end")} onClick={column?.getToggleSortingHandler()}>{label}<Icon className="h-3.5 w-3.5" /></button></th>;
}

function TablePagination({ table, resultCount }: { table: DashboardTable; resultCount: number }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const start = resultCount === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, resultCount);
  return <div className="flex flex-col gap-3 border-t bg-slate-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <p className="text-slate-500">Showing {start}–{end} of {resultCount}</p>
    <div className="flex items-center justify-between gap-3 sm:justify-end">
      <label className="flex items-center gap-2 text-slate-500">Rows
        <select className="h-8 rounded-md border bg-white px-2 text-slate-900" value={pageSize} onChange={event => table.setPageSize(Number(event.target.value))}>
          {[10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <span className="min-w-20 text-center text-slate-600">Page {resultCount ? pageIndex + 1 : 0} of {table.getPageCount()}</span>
      <div className="flex gap-1"><Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div>
    </div>
  </div>;
}

type SummaryCardProps = { label: string; value: string; detail: string; icon: typeof Gauge; trend?: string; positive?: boolean };

function formatChange(change: number, suffix = "") {
  return `${change >= 0 ? "+" : ""}${change.toFixed(suffix === " pts" ? 1 : 0)}${suffix}`;
}

function TrendIndicator({ change, suffix = "" }: { change: number | null; suffix?: string }) {
  if (change === null) return <span className="mt-0.5 block text-[10px] font-normal text-slate-400">No prior month</span>;
  const Icon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={cn("mt-0.5 flex items-center justify-end gap-0.5 text-[10px] font-medium", change >= 0 ? "text-emerald-700" : "text-rose-700")}><Icon className="h-3 w-3" />{formatChange(change, suffix)}</span>;
}

function SummaryCard({ label, value, detail, icon: Icon, trend, positive }: SummaryCardProps) {
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p></div><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span></div><div className="mt-3 flex items-center gap-1.5 text-xs"><span className="text-muted-foreground">{detail}</span>{trend && <><span className="text-muted-foreground">·</span><span className={positive ? "text-emerald-600" : "text-amber-600"}><TrendIcon className="mr-0.5 inline h-3.5 w-3.5" />{trend}</span></>}</div></CardContent></Card>;
}
