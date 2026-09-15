"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, FileSpreadsheet, RefreshCw, Search } from "lucide-react";

import { fetchMonthlyUnsubscribes } from "@/app/actions/daily-closing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { monthlyUnsubscribesQueryKey, type MonthlyUnsubscribeRow } from "@/lib/monthly-closing";
import { formatReportingMonth } from "@/lib/reporting-month";
import { useToast } from "@/hooks/use-toast";

class UnsubscribeLoadError extends Error {
  constructor(readonly reason: "invalidData" | "invalidRequest" | "sessionExpired" | "loadFailed", readonly date?: string) {
    super(reason);
  }
}

function csvCell(value: string | number) {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function MonthlyUnsubscribes({ shopId, month, onOpenReport }: { shopId: string; month: string; onOpenReport: (date: string) => void }) {
  const t = useTranslations("MonthlyUnsubscribes");
  const locale = useLocale();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 as const });
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
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
  const exportFiltered = async (format: "csv" | "xlsx") => {
    setExporting(format);
    try {
      const result = await fetchMonthlyUnsubscribes(shopId, { month, search, pageIndex: 0, pageSize: 3100 });
      if (!result.success) throw new UnsubscribeLoadError(result.error, result.date);
      const amountHeader = `${t("amount")} (Lek)`;
      const fileName = `unsubscribes-${month}.${format}`;
      if (format === "xlsx") {
        const { default: writeXlsxFile } = await import("write-excel-file/browser");
        await writeXlsxFile([
          [t("date"), t("invoice"), t("msisdn"), amountHeader].map(value => ({ value, fontWeight: "bold" as const })),
          ...result.data.rows.map(entry => [
            { value: entry.date },
            { value: entry.invoice },
            { value: entry.msisdn },
            { value: entry.amount, type: Number, format: "#,##0.00" },
          ]),
        ], {
          columns: [{ width: 12 }, { width: 24 }, { width: 18 }, { width: 16 }],
          sheet: t("sheetName").slice(0, 31),
        }).toFile(fileName);
      } else {
        const csv = `\uFEFF${[
          [t("date"), t("invoice"), t("msisdn"), amountHeader],
          ...result.data.rows.map(entry => [entry.date, entry.invoice, entry.msisdn, entry.amount]),
        ].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }
      toast({ title: t("exported", { count: result.data.rowCount }) });
    } catch (error) {
      const description = error instanceof UnsubscribeLoadError
        ? t(error.reason, { date: error.date ?? "" })
        : t("exportFailed");
      toast({ variant: "destructive", title: t("exportFailed"), description });
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

  return <section className="space-y-2" aria-label={t("title")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{t("title")} · {formatReportingMonth(month, locale)}</h2><p className="text-xs text-muted-foreground">{t("description")}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={unsubscribes.isFetching || exporting !== null} onClick={() => void unsubscribes.refetch()}><RefreshCw className="mr-1.5 h-4 w-4" />{t("refresh")}</Button>
        <Button variant="outline" size="sm" disabled={!unsubscribes.data?.rowCount || exporting !== null} onClick={() => void exportFiltered("csv")}><Download className="mr-1.5 h-4 w-4" />{t(exporting === "csv" ? "exporting" : "exportCsv")}</Button>
        <Button variant="outline" size="sm" disabled={!unsubscribes.data?.rowCount || exporting !== null} onClick={() => void exportFiltered("xlsx")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />{t(exporting === "xlsx" ? "exporting" : "exportExcel")}</Button>
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
        <SpreadsheetTable className="min-w-[680px]" aria-label={t("title")}>
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
