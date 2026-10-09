"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, flexRender, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, BriefcaseBusiness, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buildBonusOverviewBatch } from "@/app/actions/bonus-overview";
import type { BonusOverviewRow } from "@/lib/bonus-overview-index";
import type { AllTimeBonusRow, BonusOverviewMonth } from "@/lib/server/bonus-overview-data";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { RestrictedAccessPage } from "@/components/restricted-access";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { useShop } from "@/components/shop-provider";

type DisplayRow = BonusOverviewRow & { monthsCount: number };
type MonthOption = { id: string; name: string };
type AllTimeData = { rows: AllTimeBonusRow[]; missing: Array<{ month: string; shopIds: string[] }> };

async function readBonuses<T>(parameters: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/bonus-overview?${parameters}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Bonus overview request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function BonusOverviewClient({ month, months, onMonthChange }: { month: string; months: MonthOption[]; onMonthChange: (month: string) => void }) {
  const locale = useLocale();
  const t = useTranslations("BonusOverview");
  const queryClient = useQueryClient();
  const access = useRestrictedAccess();
  const { actor, shops } = useShop();
  const shopIds = useMemo(() => shops.map(shop => shop.id).sort(), [shops]);
  const allMonths = useMemo(() => [...new Set(months.map(item => item.id))].sort().reverse(), [months]);
  const [allTime, setAllTime] = useState(false);
  const [bonusMode, setBonusMode] = useState<"current" | "forecast">("current");
  const [sorting, setSorting] = useState<SortingState>([{ id: "amount", desc: true }]);
  const [completed, setCompleted] = useState(0);
  const [buildError, setBuildError] = useState(false);
  const [building, setBuilding] = useState(false);
  const buildRun = useRef(0);
  useEffect(() => () => { buildRun.current += 1; }, []);
  const monthly = useQuery<BonusOverviewMonth>({
    queryKey: ["bonus-overview", actor.id, month, shopIds],
    queryFn: ({ signal }) => readBonuses<BonusOverviewMonth>(new URLSearchParams({ scope: "month", month }), signal),
    enabled: access.data === true && shopIds.length > 0 && !allTime,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const lifetime = useQuery<AllTimeData>({
    queryKey: ["bonus-overview-all-time", actor.id, allMonths, shopIds],
    queryFn: ({ signal }) => {
      const parameters = new URLSearchParams({ scope: "all" });
      allMonths.forEach(value => parameters.append("month", value));
      return readBonuses<AllTimeData>(parameters, signal);
    },
    enabled: access.data === true && shopIds.length > 0 && allMonths.length > 0 && allTime,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const missing = useMemo(() => allTime
    ? lifetime.data?.missing ?? []
    : monthly.data?.missingShopIds.length ? [{ month, shopIds: monthly.data.missingShopIds }] : [],
  [allTime, lifetime.data?.missing, monthly.data?.missingShopIds, month]);
  const missingCount = missing.reduce((total, item) => total + item.shopIds.length, 0);
  const prepareMissing = async () => {
    if (!missingCount || building || access.data !== true) return;
    const run = ++buildRun.current;
    setBuilding(true);
    setCompleted(0);
    setBuildError(false);
    try {
      const items = missing.flatMap(task => task.shopIds.map(shopId => ({ month: task.month, shopId })));
      for (let start = 0; start < items.length; start += 2) {
        if (run !== buildRun.current) return;
        const batch = items.slice(start, start + 2);
        await buildBonusOverviewBatch({ items: batch });
        if (run !== buildRun.current) return;
        setCompleted(start + batch.length);
      }
      await queryClient.invalidateQueries({ queryKey: allTime ? ["bonus-overview-all-time"] : ["bonus-overview"] });
    } catch (error) {
      console.error("Failed to prepare bonus overview:", error);
      if (run === buildRun.current) setBuildError(true);
    } finally {
      if (run === buildRun.current) setBuilding(false);
    }
  };

  const changePeriod = (value: string) => {
    buildRun.current += 1;
    setBuilding(false);
    setCompleted(0);
    setBuildError(false);
    table.setPageIndex(0);
    if (value === "all") setAllTime(true);
    else { setAllTime(false); onMonthChange(value); }
  };

  const currency = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 }), [locale]);
  const rows = useMemo<DisplayRow[]>(() => allTime
    ? lifetime.data?.rows ?? []
    : monthly.data?.rows.map(row => ({ ...row, monthsCount: 1 })) ?? [],
  [allTime, lifetime.data?.rows, monthly.data?.rows]);
  const showForecast = !allTime && bonusMode === "forecast";
  const columns = useMemo<ColumnDef<DisplayRow>[]>(() => [
    { accessorKey: "person", header: t("person"), cell: ({ row }) => <Link className="block truncate font-medium text-emerald-700 hover:underline focus-visible:underline dark:text-emerald-300" href={`/${locale}/shop/${row.original.shopId}/bonus?${allTime ? "view=history" : `month=${month}`}`} title={row.original.role === "manager" ? t("managerAt", { shop: row.original.shopName }) : row.original.person}>{row.original.role === "manager" ? t("managerAt", { shop: row.original.shopName }) : row.original.person}</Link> },
    { accessorKey: "role", header: t("role"), cell: ({ row }) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{row.original.role === "manager" ? <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" /> : <Users className="h-3.5 w-3.5 text-muted-foreground" />}{row.original.role === "manager" ? t("manager") : t("representative")}</span> },
    { accessorKey: "shopName", header: t("shop") },
    { id: "amount", accessorFn: row => showForecast ? row.forecastAmount ?? -1 : row.amount, header: showForecast ? t("eomForecast") : allTime ? t("allTimeTotal") : t("bonus"), cell: ({ row }) => <span className="font-semibold tabular-nums">{showForecast && row.original.forecastAmount === null ? "—" : currency.format(showForecast ? row.original.forecastAmount! : row.original.amount)}</span> },
    { id: "status", accessorFn: row => allTime ? row.monthsCount : row.finalized ? 1 : 0, header: allTime ? t("months") : t("status"), cell: ({ row }) => allTime ? <span className="tabular-nums">{t("monthsCount", { count: row.original.monthsCount })}</span> : <span className={row.original.finalized ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{row.original.finalized ? t("finalized") : showForecast && row.original.forecastAsOf ? t("forecastAsOf", { date: row.original.forecastAsOf }) : t("current")}</span> },
  ], [allTime, currency, locale, month, showForecast, t]);
  const table = useReactTable({
    data: rows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });
  const query = allTime ? lifetime : monthly;
  const visibleRows = table.getRowModel().rows;
  const firstRowNumber = table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1;

  if (access.isPending) return <p className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>;
  if (!access.data) return <RestrictedAccessPage onGranted={() => void access.refetch()} />;

  return <section className="h-full min-h-0 overflow-y-auto overscroll-contain p-3 md:p-4">
    <div className="mx-auto max-w-6xl space-y-4 pb-6">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <div className="flex flex-wrap gap-2"><label className="grid gap-1 text-xs font-medium text-muted-foreground">{t("period")}<AppSelect aria-label={t("period")} className="w-48" value={allTime ? "all" : month} onValueChange={changePeriod} options={[{ value: "all", label: t("allTime") }, ...months.map(item => ({ value: item.id, label: item.name }))]} /></label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">{t("valueType")}<AppSelect aria-label={t("valueType")} className="w-48" value={allTime ? "current" : bonusMode} disabled={allTime} onValueChange={value => { table.setPageIndex(0); setBonusMode(value as "current" | "forecast"); }} options={[{ value: "current", label: t("currentBonus") }, { value: "forecast", label: t("eomForecast") }]} /></label></div>
      </div>
      {missingCount > 0 && <div role="status" className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm"><span className="flex items-center gap-2">{building && <Loader2 className="h-4 w-4 animate-spin" />}{buildError ? t("prepareError") : building ? t("preparing", { completed, total: missingCount }) : t("missing", { count: missingCount })}</span><Button size="sm" variant="outline" disabled={building} onClick={() => void prepareMissing()}>{buildError ? t("retry") : t("prepare")}</Button></div>}
      <div className="overflow-hidden rounded-md border border-slate-300 bg-card shadow-sm dark:border-slate-600">
        <div className="flex h-9 items-center gap-2 border-b border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
          <FileSpreadsheet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <span>{t("title")}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{rows.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] table-fixed border-separate border-spacing-0 text-[13px]" aria-label={t("title")}>
            <colgroup><col className="w-10" /><col className="w-[28%]" /><col className="w-[17%]" /><col className="w-[23%]" /><col className="w-[16%]" /><col className="w-[16%]" /></colgroup>
            <thead>
              <tr className="h-7 bg-slate-100 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400" aria-hidden="true">
                <th className="sticky left-0 z-20 border-b border-r border-slate-300 bg-emerald-700 dark:border-slate-600 dark:bg-emerald-800" />
                {["A", "B", "C", "D", "E"].map(letter => <th key={letter} className="border-b border-r border-slate-300 text-center font-medium last:border-r-0 dark:border-slate-600">{letter}</th>)}
              </tr>
              {table.getHeaderGroups().map(group => <tr key={group.id} className="h-9 bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <th className="sticky left-0 z-20 border-b border-r border-slate-300 bg-slate-100 text-center text-[11px] font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">#</th>
                {group.headers.map(header => {
                  const rightAligned = header.column.id === "amount" || (allTime && header.column.id === "status");
                  const sorted = header.column.getIsSorted();
                  return <th key={header.id} scope="col" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"} className="border-b border-r border-slate-300 font-semibold last:border-r-0 dark:border-slate-600">
                    <button type="button" disabled={!header.column.getCanSort()} onClick={header.column.getToggleSortingHandler()} className={`flex h-9 w-full items-center gap-1.5 px-3 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-default dark:hover:bg-emerald-950/40 ${rightAligned ? "justify-end text-right" : "justify-start text-left"} ${sorted ? "text-emerald-800 dark:text-emerald-300" : ""}`}>
                      <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      {header.column.getCanSort() && (sorted === "asc" ? <ArrowUp className="h-3.5 w-3.5 shrink-0" /> : sorted === "desc" ? <ArrowDown className="h-3.5 w-3.5 shrink-0" /> : <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />)}
                    </button>
                  </th>;
                })}
              </tr>)}
            </thead>
            <tbody>{visibleRows.map((row, index) => <tr key={row.original.id} className="group h-9 bg-card hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30">
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 text-right text-[11px] font-normal tabular-nums text-slate-500 group-hover:bg-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:group-hover:bg-emerald-950">{firstRowNumber + index}</th>
              {row.getVisibleCells().map(cell => <td key={cell.id} className={`overflow-hidden border-b border-r border-slate-200 px-3 py-1.5 align-middle last:border-r-0 dark:border-slate-700 ${cell.column.id === "amount" || (allTime && cell.column.id === "status") ? "text-right" : "text-left"} ${cell.column.id === "person" ? "sticky left-10 z-10 bg-card group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950/50" : ""}`} title={cell.column.id === "shopName" ? row.original.shopName : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        {query.isPending && shopIds.length > 0 && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>}
        {query.isError && <p role="alert" className="p-4 text-sm text-destructive">{t("error")}</p>}
        {!query.isPending && !rows.length && !missingCount && <p className="p-4 text-sm text-muted-foreground">{t(allTime ? "emptyAllTime" : "empty")}</p>}
        {!!rows.length && <div className="flex h-10 items-center justify-between border-t border-slate-300 bg-slate-50 px-2 dark:border-slate-600 dark:bg-slate-900">
          <span className="self-stretch border-t-2 border-emerald-700 bg-card px-4 pt-2 text-xs font-medium text-emerald-800 dark:border-emerald-400 dark:text-emerald-300">{t("title")}</span>
          <div className="flex items-center gap-2"><span className="text-xs tabular-nums text-muted-foreground">{t("page", { page: table.getState().pagination.pageIndex + 1, count: table.getPageCount() })}</span><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("previous")} disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("next")} disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight className="h-4 w-4" /></Button></div>
        </div>}
      </div>
    </div>
  </section>;
}
