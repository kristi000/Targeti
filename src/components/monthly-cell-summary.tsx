"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, RefreshCw } from "lucide-react";

import { fetchMonthlyCellSummary } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { monthlyCellQueryKey } from "@/lib/monthly-closing";
import { formatReportingMonth } from "@/lib/reporting-month";

type Props = {
  shopId: string;
  shopName: string;
  month: string;
  onOpenReport: (date: string) => void;
};

export function MonthlyCellSummary({ shopId, shopName, month, onOpenReport }: Props) {
  const t = useTranslations("MonthlyCell");
  const locale = useLocale();
  const summary = useQuery({
    queryKey: monthlyCellQueryKey(shopId, month),
    queryFn: () => fetchMonthlyCellSummary(shopId, month),
    staleTime: 0,
  });
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return <section className="space-y-2" aria-label={t("title")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t("title")} · {formatReportingMonth(month, locale)}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <Button variant="outline" size="sm" disabled={summary.isFetching} onClick={() => void summary.refetch()}>
        <RefreshCw className="mr-1.5 h-4 w-4" />{t("refresh")}
      </Button>
    </div>
    {summary.isPending ? <p role="status" className="rounded-lg border p-8 text-center">{t("loading")}</p>
      : summary.isError ? <p role="alert" className="rounded-lg border border-destructive p-6 text-destructive">{t("loadFailed")}</p>
      : <>
        <div className="flex items-center justify-between border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
          <span>{t("monthlyTotal")}</span>
          <strong className="tabular-nums">{formatter.format(summary.data.totalAmount)} Lek</strong>
        </div>
        <SpreadsheetTable className="min-w-[720px]" aria-label={t("title")}>
          <thead><tr><th scope="col" className="w-10 text-center">#</th><th scope="col" className="text-left">{t("date")}</th><th scope="col" className="text-left">{t("shop")}</th><th scope="col" className="text-right">{t("amount")}</th><th scope="col" className="text-left">{t("note")}</th><th scope="col" className="text-left">{t("report")}</th></tr></thead>
          <tbody>{summary.data.rows.map((row, index) => <tr key={row.date}>
            <td className="text-center text-muted-foreground">{index + 1}</td>
            <td className="whitespace-nowrap font-medium">{row.date}</td>
            <td className="whitespace-nowrap">{shopName}</td>
            <td className="whitespace-nowrap text-right tabular-nums">{formatter.format(row.amount)}</td>
            <td className="max-w-md whitespace-normal">{row.note || "—"}</td>
            <td><Button variant="link" size="sm" className="h-5 px-0 text-xs text-emerald-800 dark:text-emerald-300" onClick={() => onOpenReport(row.date)}><ArrowUpRight className="mr-1 h-3 w-3" />{t("openReport")}</Button></td>
          </tr>)}
            {summary.data.rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground">{t("empty")}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>{t("monthlyTotal")}</td><td className="whitespace-nowrap text-right tabular-nums">{formatter.format(summary.data.totalAmount)}</td><td colSpan={2} /></tr></tfoot>
        </SpreadsheetTable>
      </>}
  </section>;
}
