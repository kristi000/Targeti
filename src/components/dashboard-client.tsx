"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useLocale } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Store,
  UserRoundCog,
} from "lucide-react";

import { useShop } from "@/components/shop-provider";
import { SalesRepresentativeRanking } from "./sales-representative-ranking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { formatReportingDate, formatReportingMonth } from "@/lib/reporting-month";
import { fetchDashboardPeriods } from "@/app/actions";
import { fetchDashboardPage, type DashboardCursor, type DashboardRow, type DashboardSortKey, type DashboardSupervisorRow } from "@/app/dashboard-actions";

type ShopPerformanceRow = DashboardRow;

const shopColumns: ColumnDef<ShopPerformanceRow>[] = [
  { id: "shop", accessorFn: row => row.shop.name },
  { id: "achievement", accessorKey: "totalAchievement" },
  { id: "forecast", accessorKey: "forecastAchievement" },
  { id: "revenue", accessorKey: "revenue" },
];

export function DashboardClient() {
  const { shops, supervisors, loading, loadPerformanceMonth, setSelectedDatasetId } = useShop();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shopSearch, setShopSearch] = useState(searchParams.get("q") ?? "");
  const requestedSort = searchParams.get("sort");
  const hasRequestedSort = requestedSort === "shop" || requestedSort === "achievement" || requestedSort === "forecast" || requestedSort === "revenue";
  const initialSort: DashboardSortKey = hasRequestedSort ? requestedSort : "achievement";
  const [sorting, setSorting] = useState<SortingState>([{ id: initialSort, desc: hasRequestedSort ? searchParams.get("dir") === "desc" : true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: Math.max(Number(searchParams.get("page") ?? 1) - 1, 0), pageSize: [10, 20, 50].includes(Number(searchParams.get("size"))) ? Number(searchParams.get("size")) : 10 });
  const cursorValue = searchParams.get("afterValue");
  const initialCursor = cursorValue !== null && searchParams.get("afterName") && searchParams.get("afterId") ? {
    hasData: searchParams.get("afterHasData") === "true",
    value: searchParams.get("afterType") === "number" ? Number(cursorValue) : cursorValue,
    name: searchParams.get("afterName")!,
    id: searchParams.get("afterId")!,
  } : null;
  const [cursor, setCursor] = useState<DashboardCursor | null>(initialCursor);
  const [cursorHistory, setCursorHistory] = useState<Array<DashboardCursor | null>>(() => Array.from({ length: Math.max(Number(searchParams.get("page") ?? 1), 1) }, (_, index) => index === Math.max(Number(searchParams.get("page") ?? 1) - 1, 0) ? initialCursor : null));
  const deferredSearch = useDeferredValue(shopSearch.trim());

  const periodsQuery = useQuery({ queryKey: ["dashboard-periods"], queryFn: fetchDashboardPeriods, staleTime: 60_000 });
  const datasets = useMemo(() => (periodsQuery.data ?? []).map(period => ({
    id: period.month,
    name: period.reportDate ? formatReportingDate(period.reportDate, locale) : formatReportingMonth(period.month, locale),
  })), [periodsQuery.data, locale]);
  const requestedMonth = searchParams.get("month");
  const activeDatasetId = datasets.some(dataset => dataset.id === requestedMonth) ? requestedMonth! : datasets[0]?.id ?? new Date().toISOString().slice(0, 7);
  const previousDatasetId = useRef(activeDatasetId);

  useEffect(() => {
    if (previousDatasetId.current === activeDatasetId) return;
    previousDatasetId.current = activeDatasetId;
    setCursor(null);
    setCursorHistory([null]);
    setPagination(current => ({ ...current, pageIndex: 0 }));
  }, [activeDatasetId]);

  const pageQuery = useQuery({
    queryKey: ["firestore-shop-performance-page", activeDatasetId, deferredSearch, pagination.pageSize, cursor, sorting[0]?.id, sorting[0]?.desc],
    queryFn: () => fetchDashboardPage({ month: activeDatasetId, search: deferredSearch, pageSize: pagination.pageSize, cursor, sortBy: (sorting[0]?.id ?? "shop") as DashboardSortKey, sortDirection: sorting[0]?.desc ? "desc" : "asc" }),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const nextCursor = pageQuery.data?.nextCursor;
    if (!nextCursor) return;
    void queryClient.prefetchQuery({
      queryKey: ["firestore-shop-performance-page", activeDatasetId, deferredSearch, pagination.pageSize, nextCursor, sorting[0]?.id, sorting[0]?.desc],
      queryFn: () => fetchDashboardPage({ month: activeDatasetId, search: deferredSearch, pageSize: pagination.pageSize, cursor: nextCursor, sortBy: (sorting[0]?.id ?? "shop") as DashboardSortKey, sortDirection: sorting[0]?.desc ? "desc" : "asc" }),
      staleTime: 30_000,
    });
  }, [activeDatasetId, deferredSearch, pageQuery.data?.nextCursor, pagination.pageSize, queryClient, sorting]);

  const supervisorsById = useMemo(() => new Map(supervisors.map(supervisor => [supervisor.id, supervisor.name])), [supervisors]);
  const supervisorIdsByShop = useMemo(() => new Map(shops.map(shop => [shop.id, shop.supervisorId])), [shops]);

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
      setSorting(current => {
        const next = typeof updater === "function" ? updater(current) : updater;
      return next.length ? [next[0]] : [{ id: "achievement", desc: true }];
      });
      setCursor(null); setCursorHistory([null]); setPagination(current => ({ ...current, pageIndex: 0 }));
    },
  });

  const updateSearch = (value: string) => {
    setShopSearch(value);
    setCursor(null); setCursorHistory([null]); setPagination(current => ({ ...current, pageIndex: 0 }));
  };

  useEffect(() => {
    void loadPerformanceMonth(activeDatasetId);
    const parameters = new URLSearchParams();
    if (activeDatasetId) parameters.set("month", activeDatasetId);
    if (shopSearch.trim()) parameters.set("q", shopSearch.trim());
    if (pagination.pageIndex) parameters.set("page", String(pagination.pageIndex + 1));
    if (pagination.pageSize !== 10) parameters.set("size", String(pagination.pageSize));
    if (sorting[0]?.id && sorting[0].id !== "shop") parameters.set("sort", sorting[0].id);
    if (sorting[0]?.desc) parameters.set("dir", "desc");
    if (cursor) {
      parameters.set("afterHasData", String(cursor.hasData));
      parameters.set("afterType", typeof cursor.value);
      parameters.set("afterValue", String(cursor.value));
      parameters.set("afterName", cursor.name);
      parameters.set("afterId", cursor.id);
    }
    router.replace(`${pathname}?${parameters.toString()}`, { scroll: false });
    setSelectedDatasetId(activeDatasetId);
  }, [activeDatasetId, shopSearch, pagination.pageIndex, pagination.pageSize, sorting, cursor, pathname, router, loadPerformanceMonth, setSelectedDatasetId]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading dashboard…</div>;
  }

  if (shops.length === 0) {
    return <div className="relative flex h-full flex-col items-center justify-center gap-3"><SidebarTrigger className="absolute left-3 top-3 h-9 w-9" /><p className="text-muted-foreground">Add a shop to start tracking performance.</p></div>;
  }

  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", maximumFractionDigits: 0 });
  const visibleRows = table.getRowModel().rows;
  const resultCount = pageQuery.data?.total ?? 0;

  return (
    <div className="flex h-svh flex-col bg-muted/20">
      <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4 xl:overflow-hidden">
        <div className="mx-auto flex min-h-full max-w-[1920px] flex-col gap-4 xl:h-full">
          <SidebarTrigger className="h-9 w-9 shrink-0" />

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <section className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm xl:min-h-0">
            <div className="flex flex-col gap-3 border-b border-slate-300 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-700 p-1.5 text-white"><Store className="h-4 w-4" /></span>
                <div><h3 className="font-semibold text-slate-900">All shops</h3><p className="text-xs text-slate-500">{resultCount} matching locations</p></div>
              </div>
              <div className="flex w-full gap-2 sm:max-w-md">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={shopSearch} onChange={event => updateSearch(event.target.value)} placeholder="Search shops or supervisors…" aria-label="Search shops or supervisors" className="h-9 bg-white pl-9" />
                </div>
                <select
                  aria-label="Sort shops by"
                  className="h-9 rounded-md border bg-white px-2 text-sm text-slate-900 md:hidden"
                  value={sorting[0]?.id ?? "shop"}
                  onChange={event => table.setSorting([{ id: event.target.value, desc: sorting[0]?.desc ?? false }])}
                >
                  <option value="shop">Shop</option>
                  <option value="achievement">Performance</option>
                  <option value="forecast">Forecast</option>
                  <option value="revenue">Revenue</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 bg-white md:hidden"
                  onClick={() => table.setSorting([{ id: sorting[0]?.id ?? "shop", desc: !sorting[0]?.desc }])}
                  aria-label={sorting[0]?.desc ? "Sort ascending" : "Sort descending"}
                >
                  {sorting[0]?.desc ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="hidden min-h-0 flex-1 overflow-auto md:block">
              <table className="w-full min-w-[780px] table-fixed border-collapse text-sm xl:min-w-[440px]">
                <thead><tr className="sticky top-0 z-[1] bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  <th className="w-12 border-b border-r border-slate-300 px-2 py-2 text-center">#</th>
                  <SortableHeader table={table} columnId="shop" label="Shop" align="left" className="w-[38%]" />
                  <SortableHeader table={table} columnId="achievement" label="Performance" className="w-20 px-1" />
                  <SortableHeader table={table} columnId="forecast" label="Forecast" className="w-[4.5rem] px-1" />
                  <SortableHeader table={table} columnId="revenue" label="Revenue" className="w-24 px-1" />
                  <th className="w-64 border-b border-r border-slate-300 px-3 py-2 text-left xl:hidden">Target progress</th>
                </tr></thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => {
                    const item = row.original;
                    const destination = `/${locale}/shop/${item.shop.id}`;
                    const supervisorName = supervisorsById.get(supervisorIdsByShop.get(item.shop.id) ?? "") ?? "Unassigned";
                    return <tr key={item.shop.id} tabIndex={0} aria-label={`Open ${item.shop.name}`} className="cursor-pointer bg-white even:bg-slate-50/70 hover:bg-emerald-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" onClick={() => router.push(destination)} onKeyDown={event => { if (event.key === "Enter") router.push(destination); }}>
                      <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center"><span className={cn("mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold leading-none", pagination.pageIndex * pagination.pageSize + rowIndex < 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{pagination.pageIndex * pagination.pageSize + rowIndex + 1}</span></td>
                      <th scope="row" className="border-b border-r border-slate-200 px-2 py-0.5 text-left leading-tight"><span className="block whitespace-nowrap text-[13px] font-medium text-slate-900">{item.shop.name}</span><span className="block whitespace-nowrap text-[11px] font-normal text-slate-500">Supervisor: {supervisorName}</span></th>
                      <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center text-xs font-semibold leading-tight tabular-nums text-slate-900">{item.hasData ? `${item.totalAchievement.toFixed(1)}%` : "—"}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center text-xs leading-tight tabular-nums text-slate-700">{item.isFinal ? <span className="font-medium text-slate-900">Final</span> : item.forecastAchievement === null ? "—" : `${item.forecastAchievement.toFixed(1)}%`}</td>
                      <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center text-xs leading-tight tabular-nums text-slate-700">{item.hasData ? currency.format(item.revenue) : "—"}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-1 text-center xl:hidden">{item.hasData ? <div className="flex items-center justify-center gap-3"><Progress value={item.totalAchievement} max={120} markerValue={100} className="h-2 flex-1 rounded-sm bg-slate-200" /><span className="w-12 text-center font-mono text-xs font-medium text-slate-600">{item.totalAchievement.toFixed(0)}%</span></div> : <span className="text-xs text-slate-500">Not imported</span>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {visibleRows.map((row, rowIndex) => {
                const item = row.original;
                const supervisorName = supervisorsById.get(supervisorIdsByShop.get(item.shop.id) ?? "") ?? "Unassigned";
                const rowNumber = pagination.pageIndex * pagination.pageSize + rowIndex + 1;
                return <Link key={item.shop.id} href={`/${locale}/shop/${item.shop.id}`} className="flex items-center justify-between gap-3 p-2 transition-colors hover:bg-emerald-50/70">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{rowNumber}</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{item.shop.name}</p>
                      <p className="truncate text-xs text-slate-500">{supervisorName}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <div>
                      <p className="font-semibold tabular-nums text-slate-900">{item.hasData ? `${item.totalAchievement.toFixed(1)}%` : "—"}</p>
                      <p className="text-xs tabular-nums text-slate-500">EOM: {item.isFinal ? "Final" : item.forecastAchievement === null ? "—" : `${item.forecastAchievement.toFixed(1)}%`}</p>
                    </div>
                  </div>
                </Link>;
              })}
            </div>

            {visibleRows.length === 0 && <div className="px-4 py-12 text-center text-sm text-slate-500">No shops match your search.</div>}
            <TablePagination table={table} resultCount={resultCount} />
          </section>

          <SupervisorPerformanceTable rows={pageQuery.data?.supervisorRows ?? []} currency={currency} />

          <section className="min-h-[32rem] min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm xl:min-h-0"><SalesRepresentativeRanking /></section>
          </div>
        </div>
      </main>
    </div>
  );
}

function SupervisorPerformanceTable({ rows, currency }: { rows: DashboardSupervisorRow[]; currency: Intl.NumberFormat }) {
  return <section className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm xl:min-h-0" aria-labelledby="supervisor-performance-heading">
    <div className="flex items-center gap-2 border-b border-slate-300 bg-slate-50 px-4 py-3">
      <span className="rounded bg-indigo-700 p-1.5 text-white"><UserRoundCog className="h-4 w-4" /></span>
      <div><h3 id="supervisor-performance-heading" className="font-semibold text-slate-900">Supervisor performance</h3><p className="text-xs text-slate-500">All assigned shops in the selected reporting period</p></div>
    </div>
    <div className="hidden min-h-0 flex-1 overflow-auto md:block">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-sm xl:min-w-[360px]">
        <thead><tr className="sticky top-0 z-[1] bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700">
          <th className="w-12 border-b border-r border-slate-300 px-2 py-2 text-center">#</th>
          <th className="w-[45%] border-b border-r border-slate-300 px-2 py-2 text-left">Supervisor</th>
          <th className="w-20 border-b border-r border-slate-300 px-1 py-2 text-center">Performance</th>
          <th className="w-20 border-b border-r border-slate-300 px-1 py-2 text-center">Forecast</th>
          <th className="border-b border-r border-slate-300 px-3 py-2 text-center xl:hidden">Revenue</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id} className="bg-white even:bg-slate-50/70">
          <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center"><span className={cn("mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold leading-none", index < 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{index + 1}</span></td>
          <th scope="row" className="border-b border-r border-slate-200 px-2 py-0.5 text-left leading-tight"><span className="block whitespace-nowrap text-[13px] font-medium text-slate-900">{row.name}</span><span className="block text-[11px] font-normal text-slate-500">{row.shopCount} shop{row.shopCount === 1 ? "" : "s"}</span></th>
          <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center text-xs font-semibold leading-tight tabular-nums text-slate-900">{row.activeShops ? `${row.averageAchievement.toFixed(1)}%` : "—"}</td>
          <td className="border-b border-r border-slate-200 px-1 py-0.5 text-center text-xs leading-tight tabular-nums text-slate-700">{row.forecastAchievement === null ? "—" : `${row.forecastAchievement.toFixed(1)}%`}</td>
          <td className="border-b border-r border-slate-200 px-3 py-0.5 text-center leading-tight tabular-nums text-slate-700 xl:hidden">{currency.format(row.revenue)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="divide-y md:hidden">{rows.map((row, index) => <div key={row.id} className="flex items-center gap-3 p-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">{index + 1}</span>
      <div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{row.name}</p><p className="text-xs text-slate-500">{row.shopCount} shop{row.shopCount === 1 ? "" : "s"}</p></div>
      <div className="shrink-0 text-right"><p className="font-semibold tabular-nums text-slate-900">{row.activeShops ? `${row.averageAchievement.toFixed(1)}%` : "—"}</p><p className="text-xs tabular-nums text-slate-500">EOM {row.forecastAchievement === null ? "—" : `${row.forecastAchievement.toFixed(1)}%`}</p></div>
    </div>)}</div>
    {!rows.length && <div className="px-4 py-10 text-center text-sm text-slate-500">No supervisors have assigned shops.</div>}
  </section>;
}

type DashboardTable = ReturnType<typeof useReactTable<ShopPerformanceRow>>;

function SortableHeader({ table, columnId, label, align = "center", className }: { table: DashboardTable; columnId: string; label: string; align?: "left" | "center"; className?: string }) {
  const column = table.getColumn(columnId);
  const direction = column?.getIsSorted();
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return <th aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"} className={cn("border-b border-r border-slate-300 px-3 py-2", align === "left" ? "text-left" : "text-center", className)}><button type="button" className={cn("inline-flex w-full items-center gap-1", align === "left" ? "justify-start" : "justify-center")} onClick={column?.getToggleSortingHandler()}>{label}<Icon className="h-3.5 w-3.5" /></button></th>;
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
