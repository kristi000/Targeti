"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";

import { fetchMonthlyUnsubscribes } from "@/app/actions/daily-closing";
import { Button } from "@/components/ui/button";
import { ReportExportButtons } from "@/components/report-export-buttons";
import { Input } from "@/components/ui/input";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { monthlyUnsubscribesQueryKey, type MonthlyUnsubscribeRow } from "@/lib/monthly-closing";
import { formatReportingMonth } from "@/lib/reporting-month";
import { useToast } from "@/hooks/use-toast";
import { exportReport, type ReportExportFormat } from "@/lib/report-export";

class UnsubscribeLoadError extends Error {
  constructor(readonly reason: "invalidData" | "invalidRequest" | "sessionExpired" | "loadFailed", readonly date?: string) {
    super(reason);
  }
}

export function MonthlyUnsubscribes({ shopId, month, onOpenReport }: { shopId: string; month: string; onOpenReport: (date: string) => void }) {
  const t = useTranslations("MonthlyUnsubscribes");
  const exportTranslations = useTranslations("ReportExport");
  const locale = useLocale();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 as const });
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  const unsubscribes = useQuery({
    queryKey: [...monthlyUnsubscribesQueryKey(shopId, month), search, pagination.pageIndex],
    queryFn: async () => {
      const result = await fetchMonthlyUnsubscribes(shopId, { month, search, ...pagination });
      if (!result.success) throw new UnsubscribeLoadError(result.error, result.date);
      return result.data;
    },
    retry: (attempt, error) => !(error instanceof UnsubscribeLoadError) && attempt < 1,
    staleTime: 0,
  });
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invalidReportDate = unsubscribes.error instanceof UnsubscribeLoadError ? unsubscribes.error.date : undefined;
  const exportFiltered = async (exportFormat: ReportExportFormat) => {
    setExporting(exportFormat);
    try {
      const rows: MonthlyUnsubscribeRow[] = [];
      let rowCount = 0;
      for (let pageIndex = 0; ; pageIndex += 1) {
        const result = await fetchMonthlyUnsubscribes(shopId, { month, search, pageIndex, pageSize: 3100 });
        if (!result.success) throw new UnsubscribeLoadError(result.error, result.date);
        rows.push(...result.data.rows);
        rowCount = result.data.rowCount;
        if (rows.length >= rowCount) break;
        if (result.data.rows.length === 0 || pageIndex >= 3100) throw new Error("INCOMPLETE_EXPORT");
      }
      await exportReport({
        rows,
        columns: [
          { header: t("date"), value: row => row.date, width: 13 },
          { header: t("invoice"), value: row => row.invoice, width: 24 },
          { header: t("msisdn"), value: row => row.msisdn, width: 18 },
          { header: `${t("amount")} (Lek)`, value: row => row.amount, width: 16 },
        ],
        fileName: `unsubscribes-${month}`,
        sheetName: t("sheetName"),
        format: exportFormat,
      });
      toast({ title: exportTranslations("exported", { count: rows.length }) });
    } catch (error) {
      const description = error instanceof UnsubscribeLoadError
        ? t(error.reason, { date: error.date ?? "" })
        : error instanceof Error && error.message === "INCOMPLETE_EXPORT"
          ? exportTranslations("tooManyRows")
          : exportTranslations("exportFailed");
      toast({ variant: "destructive", title: exportTranslations("exportFailed"), description });
    } finally {
      setExporting(null);
    }
  };
  const columns: ColumnDef<MonthlyUnsubscribeRow>[] = [
    { accessorKey: "date", header: t("date") },
    { accessorKey: "invoice", header: t("invoice") },
    { accessorKey: "msisdn", header: t("msisdn") },
    { accessorKey: "amount", header: `${t("amount")} (Lek)`, cell: ({ row }) => formatter.format(row.original.amount) },
    { id: "report", header: t("report"), cell: ({ row }) => <Button variant="link" size="sm" className="h-5 px-0 text-xs text-emerald-800 dark:text-emerald-300" onClick={() => onOpenReport(row.original.date)}><ArrowUpRight className="mr-1 h-3 w-3" />{t("openReport")}</Button> },
  ];
  const table = useReactTable({
    data: unsubscribes.data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: unsubscribes.data?.rowCount ?? 0,
    state: { pagination },
    onPaginationChange: updater => setPagination(current => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return { pageIndex: next.pageIndex, pageSize: 20 };
    }),
    getRowId: row => row.id,
  });

  return <section className="w-fit max-w-[700px] space-y-2" aria-label={t("title")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{t("title")} · {formatReportingMonth(month, locale)}</h2><p className="text-xs text-muted-foreground">{t("description")}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-8" disabled={unsubscribes.isFetching || exporting !== null} onClick={() => void unsubscribes.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />{t("refresh")}</Button>
        <ReportExportButtons disabled={!unsubscribes.data?.rowCount} exporting={exporting} onExport={format => void exportFiltered(format)} />
      </div>
    </div>
    <div className="border border-slate-300 bg-slate-50 p-1.5 dark:border-slate-600 dark:bg-slate-900"><div className="relative max-w-md"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="h-7 rounded-none pl-7 text-xs" aria-label={t("search")} placeholder={t("search")} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPagination({ pageIndex: 0, pageSize: 20 }); }} /></div></div>
    {unsubscribes.isPending ? <p role="status" className="p-8 text-center">{t("loading")}</p>
      : unsubscribes.isError ? <div role="alert" className="space-y-2 rounded-lg border border-destructive p-6 text-destructive">
        <p>{unsubscribes.error instanceof UnsubscribeLoadError ? t(unsubscribes.error.reason, { date: unsubscribes.error.date ?? "" }) : t("loadFailed")}</p>
        {invalidReportDate && <Button variant="outline" size="sm" onClick={() => onOpenReport(invalidReportDate)}><ArrowUpRight className="mr-1 h-4 w-4" />{t("openReport")}</Button>}
      </div>
      : <>
        <dl className="grid grid-cols-[1fr_auto] border border-slate-300 bg-slate-50 text-xs sm:grid-cols-[1fr_auto_1fr_auto] dark:border-slate-600 dark:bg-slate-900 [&>*]:border-b [&>*]:border-r [&>*]:border-slate-300 [&>*]:px-3 [&>*]:py-2 dark:[&>*]:border-slate-600">
          <dt>{t("total")}</dt><dd className="text-right font-bold tabular-nums">{formatter.format(unsubscribes.data.totalAmount)} Lek</dd>
          <dt>{t("count")}</dt><dd className="text-right font-bold tabular-nums">{unsubscribes.data.totalCount}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">{t("totalsNote")}</p>
        <SpreadsheetTable aria-label={t("title")}>
          <thead>{table.getHeaderGroups().map(group => <tr key={group.id}><th scope="col" className="w-10 text-center">#</th>{group.headers.map(header => <th scope="col" key={header.id} className={header.column.id === "amount" ? "text-right" : "text-left"}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
          <tbody>{table.getRowModel().rows.map((row, index) => <tr key={row.id}><td className="text-center text-muted-foreground">{pagination.pageIndex * pagination.pageSize + index + 1}</td>{row.getVisibleCells().map(cell => <td className={cell.column.id === "amount" ? "whitespace-nowrap text-right" : "whitespace-nowrap"} key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}
            {unsubscribes.data.rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground">{t(unsubscribes.data.totalCount === 0 ? "empty" : "noMatches")}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={4}>{t("total")}</td><td className="whitespace-nowrap text-right">{formatter.format(unsubscribes.data.totalAmount)}</td><td>{t("count")}: {unsubscribes.data.totalCount}</td></tr></tfoot>
        </SpreadsheetTable>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("matches", { count: unsubscribes.data.rowCount })}</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft className="mr-1 h-4 w-4" />{t("previous")}</Button><Button variant="outline" size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>{t("next")}<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
        </div>
      </>}
  </section>;
}
