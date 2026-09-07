"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";

import { fetchMonthlyClosingSummary } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { SpreadsheetTable } from "@/components/ui/spreadsheet-table";
import { monthlyClosingQueryKey } from "@/lib/monthly-closing";
import { formatReportingMonth } from "@/lib/reporting-month";

const amounts = ["boss", "invoice", "unsubscribe", "debt", "net"] as const;

export function MonthlyClosingSummary({ shopId, month }: { shopId: string; month: string }) {
  const t = useTranslations("MonthlyClosing");
  const locale = useLocale();
  const summary = useQuery({
    queryKey: monthlyClosingQueryKey(shopId, month),
    queryFn: () => fetchMonthlyClosingSummary(shopId, month),
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
        <div className="border border-slate-300 bg-slate-50 px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-900">{t("formula")}</div>
        <SpreadsheetTable className="min-w-[760px]" aria-label={t("title")}>
          <thead><tr><th scope="col" className="w-10 text-center">#</th><th scope="col" className="text-left">{t("date")}</th>{amounts.map(key => <th scope="col" key={key} className="text-right">{t(key)}</th>)}</tr></thead>
          <tbody>{summary.data.rows.map((row, index) => <tr key={row.date}>
            <td className="text-center text-muted-foreground">{index + 1}</td>
            <td className="whitespace-nowrap font-medium">{row.date}</td>
            {amounts.map(key => <td key={key} className={`whitespace-nowrap text-right ${key === "net" ? "bg-emerald-50/50 font-semibold dark:bg-emerald-950/30" : ""} ${row[key] < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatter.format(row[key])}</td>)}
          </tr>)}
            {summary.data.rows.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground">{t("empty")}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={2}>{t("total")}</td>{amounts.map(key => <td key={key} className="whitespace-nowrap text-right">{formatter.format(summary.data.totals[key])}</td>)}</tr></tfoot>
        </SpreadsheetTable>
        <p className="text-xs text-muted-foreground">{t("reports", { count: summary.data.rows.length })}</p>
      </>}
  </section>;
}
