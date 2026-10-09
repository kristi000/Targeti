"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, RefreshCw } from "lucide-react";

import { fetchMonthlyCellSummary } from "@/app/actions/daily-closing";
import { Button } from "@/components/ui/button";
import { ReportExportButtons } from "@/components/report-export-buttons";
import { ShopPageToolbar } from "@/components/shop-page-toolbar";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { useToast } from "@/hooks/use-toast";
import { monthlyCellQueryKey } from "@/lib/monthly-closing";
import { exportReport, type ReportExportFormat } from "@/lib/report-export";

type Props = {
  shopId: string;
  shopName: string;
  month: string;
  periodSelector?: ReactNode;
  onOpenReport: (date: string) => void;
};

export function MonthlyCellSummary({ shopId, shopName, month, onOpenReport, periodSelector }: Props) {
  const t = useTranslations("MonthlyCell");
  const exportTranslations = useTranslations("ReportExport");
  const locale = useLocale();
  const { toast } = useToast();
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
  const summary = useQuery({
    queryKey: monthlyCellQueryKey(shopId, month),
    queryFn: () => fetchMonthlyCellSummary(shopId, month),
    staleTime: 0,
  });
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const handleExport = async (exportFormat: ReportExportFormat) => {
    if (!summary.data) return;
    setExporting(exportFormat);
    try {
      await exportReport({
        rows: summary.data.rows,
        columns: [
          { header: t("date"), value: row => row.date, width: 13 },
          { header: t("shop"), value: () => shopName, width: 24 },
          { header: t("amount"), value: row => row.amount, width: 18, numberFormat: "0" },
          { header: t("note"), value: row => row.note, width: 36 },
        ],
        fileName: `cell-summary-${month}`,
        sheetName: t("title"),
        format: exportFormat,
      });
      toast({ title: exportTranslations("exported", { count: summary.data.rows.length }) });
    } catch {
      toast({ variant: "destructive", title: exportTranslations("exportFailed") });
    } finally {
      setExporting(null);
    }
  };

  return <section className="w-fit max-w-[min(100%,720px)] space-y-2" aria-label={t("title")}>
    <ShopPageToolbar periodSelector={periodSelector}>
      <Button variant="outline" size="sm" className="h-8" disabled={summary.isFetching} onClick={() => void summary.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />{t("refresh")}</Button>
      <ReportExportButtons disabled={!summary.data?.rows.length} exporting={exporting} onExport={format => void handleExport(format)} />
    </ShopPageToolbar>
    {summary.isPending ? <p role="status" className="rounded-lg border p-8 text-center">{t("loading")}</p>
      : summary.isError ? <p role="alert" className="rounded-lg border border-destructive p-6 text-destructive">{t("loadFailed")}</p>
      : <>
        <div className="flex items-center justify-between border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
          <span>{t("monthlyTotal")}</span>
          <strong className="tabular-nums">{formatter.format(summary.data.totalAmount)} Lek</strong>
        </div>
        <SpreadsheetTable aria-label={t("title")}>
          <thead><tr><th scope="col" className="w-10 text-center">#</th><th scope="col" className="text-left">{t("date")}</th><th scope="col" className="text-left">{t("shop")}</th><th scope="col" className="text-right">{t("amount")}</th><th scope="col" className="text-left">{t("note")}</th><th scope="col" className="text-left">{t("report")}</th></tr></thead>
          <tbody>{summary.data.rows.map((row, index) => <tr key={row.date}>
            <td className="text-center text-muted-foreground">{index + 1}</td>
            <td className="whitespace-nowrap font-medium">{row.date}</td>
            <td className="max-w-36 truncate" title={shopName}>{shopName}</td>
            <td className="whitespace-nowrap text-right tabular-nums">{formatter.format(row.amount)}</td>
            <td className="max-w-48 truncate" title={row.note}>{row.note || "—"}</td>
            <td><Button variant="link" size="sm" className="h-5 px-0 text-xs text-emerald-800 dark:text-emerald-300" onClick={() => onOpenReport(row.date)}><ArrowUpRight className="mr-1 h-3 w-3" />{t("openReport")}</Button></td>
          </tr>)}
            {summary.data.rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground">{t("empty")}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>{t("monthlyTotal")}</td><td className="whitespace-nowrap text-right tabular-nums">{formatter.format(summary.data.totalAmount)}</td><td colSpan={2} /></tr></tfoot>
        </SpreadsheetTable>
      </>}
  </section>;
}
