"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ArrowLeft, ArrowUpRight, Download, Loader2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { fetchBonusHistoryPage, fetchBonusSnapshot, fetchQuarterlyBonusSnapshot } from "@/app/actions/bonus";
import { ManagerBonusCard } from "@/components/manager-bonus-card";
import { RepresentativeBonusCards } from "@/components/representative-bonus-cards";
import { AppSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { useShop } from "@/components/shop-provider";
import { useToast } from "@/hooks/use-toast";
import { type BonusHistoryCursor, type BonusHistoryMonth, bonusHistoryPersonAmount, monthlyPredictionRecord, quarterlyPayoutMonth, quarterlyPredictionRecord } from "@/lib/bonus-history";
import { getMonthlyBonusForecast } from "@/lib/forecast";
import { bonusHistoryQueryKey, bonusSnapshotQueryKey, quarterlyBonusSnapshotQueryKey } from "@/lib/query-keys";
import { shopPerformanceIndexQueryOptions, shopPerformanceMonthQueryOptions } from "@/lib/performance-queries";
import { calculateQuarterlyBonus, getQuarterMonths, getQuarterlyForecastMonth, getQuarterlyMonthFromSnapshot } from "@/lib/quarterly-bonus";
import { formatReportingMonth } from "@/lib/reporting-month";
import { exportReport } from "@/lib/report-export";
import { getQuarterKey } from "@/lib/types";

type Detail = { kind: "monthly" | "quarterly"; period: string };
type CsvRow = { month: string; id: string; name: string; role: "manager" | "representative"; monthly: number; quarterly: number; total: number; monthlyStatus: string; quarterlyStatus: string; monthlyAsOf: string; quarterlyAsOf: string; monthlyFinalized: string; quarterlyFinalized: string };

export function BonusHistoryClient({ shopId, detail }: { shopId: string; detail?: Detail }) {
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const pathname = usePathname();
  const { selectedShop, allMonthlyTargets } = useShop();
  const { toast } = useToast();
  const [personId, setPersonId] = useState("");
  const [exporting, setExporting] = useState(false);
  const history = useInfiniteQuery({
    queryKey: bonusHistoryQueryKey(shopId),
    queryFn: ({ pageParam }) => fetchBonusHistoryPage(shopId, pageParam),
    initialPageParam: undefined as BonusHistoryCursor | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const historyRows = useMemo(() => history.data?.pages.flatMap(page => page.rows) ?? [], [history.data]);
  const indexQuery = useQuery({ ...shopPerformanceIndexQueryOptions(shopId), enabled: Boolean(selectedShop) });
  const latestMonth = useMemo(() => indexQuery.data?.map(entry => entry.date.slice(0, 7)).sort().at(-1) ?? "", [indexQuery.data]);
  const latestSnapshot = useQuery({
    queryKey: bonusSnapshotQueryKey(shopId, latestMonth),
    queryFn: () => fetchBonusSnapshot(shopId, latestMonth),
    enabled: Boolean(latestMonth),
    staleTime: 60_000,
  });
  const performanceQuery = useQuery({
    ...shopPerformanceMonthQueryOptions(shopId, latestMonth),
    enabled: Boolean(selectedShop && latestMonth && !latestSnapshot.isPending && latestSnapshot.data === null),
  });
  const forecast = useMemo(() => selectedShop && latestMonth && performanceQuery.data && latestSnapshot.data === null
    ? getMonthlyBonusForecast(selectedShop, latestMonth, performanceQuery.data, allMonthlyTargets[shopId])
    : null, [selectedShop, latestMonth, performanceQuery.data, latestSnapshot.data, allMonthlyTargets, shopId]);
  const prediction = useMemo(() => forecast ? monthlyPredictionRecord(forecast) : null, [forecast]);
  const isQuarterEnd = Boolean(latestMonth && Number(latestMonth.slice(5)) % 3 === 0);
  const latestQuarter = isQuarterEnd ? getQuarterKey(latestMonth) : "";
  const quarterMonths = isQuarterEnd ? getQuarterMonths(latestQuarter) : [];
  const quarterSnapshot = useQuery({
    queryKey: quarterlyBonusSnapshotQueryKey(shopId, latestQuarter),
    queryFn: () => fetchQuarterlyBonusSnapshot(shopId, latestQuarter),
    enabled: isQuarterEnd,
    staleTime: 60_000,
  });
  const quarterMonthQueries = useQueries({ queries: quarterMonths.map(month => ({
    queryKey: bonusSnapshotQueryKey(shopId, month),
    queryFn: () => fetchBonusSnapshot(shopId, month),
    enabled: isQuarterEnd,
    staleTime: 60_000,
  })) });
  const firstQuarterMonth = quarterMonthQueries[0]?.data;
  const secondQuarterMonth = quarterMonthQueries[1]?.data;
  const thirdQuarterMonth = quarterMonthQueries[2]?.data;
  const quarterlyForecast = useMemo(() => selectedShop && isQuarterEnd && !thirdQuarterMonth && performanceQuery.data
    ? getQuarterlyForecastMonth(selectedShop, latestMonth, performanceQuery.data, allMonthlyTargets[shopId])
    : null, [selectedShop, isQuarterEnd, thirdQuarterMonth, performanceQuery.data, latestMonth, allMonthlyTargets, shopId]);
  const quarterPrediction = useMemo(() => {
    if (!isQuarterEnd || quarterSnapshot.data !== null) return null;
    const inputs = [firstQuarterMonth, secondQuarterMonth, thirdQuarterMonth].map((snapshot, index) => snapshot
      ? getQuarterlyMonthFromSnapshot(snapshot)
      : index === 2 ? quarterlyForecast?.input ?? null : null);
    if (!inputs.every((item): item is NonNullable<typeof item> => item !== null)) return null;
    return quarterlyPredictionRecord(calculateQuarterlyBonus(latestQuarter, inputs), quarterlyForecast?.asOfDate ?? new Date());
  }, [isQuarterEnd, quarterSnapshot.data, firstQuarterMonth, secondQuarterMonth, thirdQuarterMonth, quarterlyForecast, latestQuarter]);
  const rows = useMemo(() => {
    const existing = historyRows.find(row => row.month === latestMonth);
    const monthPrediction = existing?.monthly ? null : prediction;
    const quarterForecast = existing?.quarterly ? null : quarterPrediction;
    if (!monthPrediction && !quarterForecast) return historyRows;
    if (existing) return historyRows.map(row => row.month === latestMonth ? { ...row, prediction: monthPrediction ?? undefined, quarterPrediction: quarterForecast ?? undefined } : row);
    return [...historyRows, { month: latestMonth, monthly: null, quarterly: null, prediction: monthPrediction ?? undefined, quarterPrediction: quarterForecast ?? undefined }].sort((a, b) => b.month.localeCompare(a.month));
  }, [historyRows, latestMonth, prediction, quarterPrediction]);
  const people = useMemo(() => {
    const found = new Map<string, string>();
    rows.forEach(row => [row.monthly, row.quarterly, row.prediction, row.quarterPrediction].forEach(record => record?.people.forEach(person => {
      if (!found.has(person.id)) found.set(person.id, person.role === "manager" ? t("managerQuarterlyBonus") : person.name);
    })));
    return [...found].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [rows, locale, t]);
  const visibleRows = useMemo(() => personId
    ? rows.filter(row => [row.monthly, row.quarterly, row.prediction, row.quarterPrediction].some(record => record?.people.some(person => person.id === personId)))
    : rows, [rows, personId]);
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 }), [locale]);
  const columns = useMemo<ColumnDef<BonusHistoryMonth>[]>(() => [
    { accessorKey: "month", header: t("payoutMonth"), cell: ({ row }) => <div className="space-y-1"><span className="font-medium">{formatReportingMonth(row.original.month, locale)}</span>{(row.original.prediction || row.original.quarterPrediction) && <span className="flex w-fit items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300"><Sparkles className="h-3 w-3" />{t("prediction")}</span>}</div> },
    { id: "monthly", header: t("monthlyBonuses"), cell: ({ row }) => <div>{money.format(personId ? bonusHistoryPersonAmount(row.original, personId).monthly : row.original.monthly?.total ?? row.original.prediction?.total ?? 0)}{row.original.prediction && <span className="block text-[11px] text-sky-700 dark:text-sky-300">{t("prediction")}</span>}</div> },
    { id: "quarterly", header: t("quarterlyBonus"), cell: ({ row }) => <div>{money.format(personId ? bonusHistoryPersonAmount(row.original, personId).quarterly : row.original.quarterly?.total ?? row.original.quarterPrediction?.total ?? 0)}{row.original.quarterPrediction && <span className="block text-[11px] text-sky-700 dark:text-sky-300">{t("prediction")}</span>}</div> },
    { id: "total", header: t("payoutTotal"), cell: ({ row }) => {
      const amounts = personId ? bonusHistoryPersonAmount(row.original, personId) : { monthly: row.original.monthly?.total ?? row.original.prediction?.total ?? 0, quarterly: row.original.quarterly?.total ?? row.original.quarterPrediction?.total ?? 0 };
      return <strong>{money.format(amounts.monthly + amounts.quarterly)}</strong>;
    } },
    { id: "finalizedAt", header: t("finalizedAt"), cell: ({ row }) => <div className="space-y-1 text-xs text-muted-foreground">{row.original.prediction && <p>{t("monthlyBonuses")}: {t("predictionAsOf", { date: new Date(row.original.prediction.asOfDate).toLocaleDateString(locale) })}</p>}{row.original.quarterPrediction && <p>{t("quarterlyBonus")}: {t("predictionAsOf", { date: new Date(row.original.quarterPrediction.asOfDate).toLocaleDateString(locale) })}</p>}{row.original.monthly && <p>{t("monthlyBonuses")}: {new Date(row.original.monthly.finalizedAt).toLocaleDateString(locale)}</p>}{row.original.quarterly && <p>{t("quarterlyBonus")}: {new Date(row.original.quarterly.finalizedAt).toLocaleDateString(locale)}</p>}</div> },
    { id: "breakdown", header: t("breakdown"), cell: ({ row }) => <div className="flex flex-wrap gap-2">{row.original.prediction && <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`${pathname}?month=${row.original.month}`}>{t("viewPrediction")}<ArrowUpRight className="h-3.5 w-3.5" /></Link>}{row.original.quarterPrediction && <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`${pathname}?view=quarterly&quarter=${getQuarterKey(row.original.month)}`}>{t("viewQuarterPrediction")}<ArrowUpRight className="h-3.5 w-3.5" /></Link>}{row.original.monthly && <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`${pathname}?view=history&kind=monthly&period=${row.original.monthly.period}`}>{t("monthlyBonuses")}<ArrowUpRight className="h-3.5 w-3.5" /></Link>}{row.original.quarterly && <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`${pathname}?view=history&kind=quarterly&period=${row.original.quarterly.period}`}>{t("quarterlyBonus")}<ArrowUpRight className="h-3.5 w-3.5" /></Link>}</div> },
  ], [t, locale, money, personId, pathname]);
  const table = useReactTable({ data: visibleRows, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: BonusHistoryMonth[] = [];
      let cursor: BonusHistoryCursor | undefined;
      for (let page = 0; page < 500; page += 1) {
        const result = await fetchBonusHistoryPage(shopId, cursor);
        all.push(...result.rows);
        if (!result.nextCursor) break;
        if (page === 499) throw new Error("EXPORT_LIMIT");
        cursor = result.nextCursor;
      }
      const [freshMonth, freshQuarter] = await Promise.all([
        prediction ? fetchBonusSnapshot(shopId, latestMonth) : null,
        quarterPrediction ? fetchQuarterlyBonusSnapshot(shopId, latestQuarter) : null,
      ]);
      if (prediction && !freshMonth || quarterPrediction && !freshQuarter) {
        let current = all.find(row => row.month === latestMonth);
        if (!current) { current = { month: latestMonth, monthly: null, quarterly: null }; all.unshift(current); }
        if (prediction && !freshMonth && !current.monthly) current.prediction = prediction;
        if (quarterPrediction && !freshQuarter && !current.quarterly) current.quarterPrediction = quarterPrediction;
      }
      const csvRows: CsvRow[] = all.flatMap(row => {
        const ids = new Set([...row.monthly?.people.map(person => person.id) ?? [], ...row.quarterly?.people.map(person => person.id) ?? [], ...row.prediction?.people.map(person => person.id) ?? [], ...row.quarterPrediction?.people.map(person => person.id) ?? []]);
        return [...ids].filter(id => !personId || personId === id).map(id => {
          const person = row.monthly?.people.find(item => item.id === id) ?? row.quarterly?.people.find(item => item.id === id) ?? row.prediction?.people.find(item => item.id === id) ?? row.quarterPrediction?.people.find(item => item.id === id);
          if (!person) return null;
          const amounts = bonusHistoryPersonAmount(row, id);
          return { month: row.month, id, name: person.role === "manager" ? t("managerQuarterlyBonus") : person.name, role: person.role, monthly: amounts.monthly, quarterly: amounts.quarterly, total: amounts.monthly + amounts.quarterly, monthlyStatus: row.monthly ? t("finalized") : row.prediction ? t("prediction") : "", quarterlyStatus: row.quarterly ? t("finalized") : row.quarterPrediction ? t("prediction") : "", monthlyAsOf: row.prediction?.asOfDate ?? "", quarterlyAsOf: row.quarterPrediction?.asOfDate ?? "", monthlyFinalized: row.monthly?.finalizedAt ?? "", quarterlyFinalized: row.quarterly?.finalizedAt ?? "" };
        }).filter((item): item is CsvRow => item !== null);
      });
      await exportReport({
        rows: csvRows,
        columns: [
          { header: t("payoutMonth"), value: row => row.month },
          { header: t("representative"), value: row => row.name },
          { header: "ID", value: row => row.role === "representative" ? row.id.slice(4) : "" },
          { header: t("role"), value: row => row.role === "manager" ? t("managerQuarterlyBonus") : t("representative") },
          { header: t("monthlyBonuses"), value: row => row.monthly, numberFormat: "0" },
          { header: t("quarterlyBonus"), value: row => row.quarterly, numberFormat: "0" },
          { header: t("payoutTotal"), value: row => row.total, numberFormat: "0" },
          { header: `${t("monthlyBonuses")} ${t("status")}`, value: row => row.monthlyStatus },
          { header: `${t("quarterlyBonus")} ${t("status")}`, value: row => row.quarterlyStatus },
          { header: `${t("monthlyBonuses")} ${t("predictionAsOfHeader")}`, value: row => row.monthlyAsOf },
          { header: `${t("quarterlyBonus")} ${t("predictionAsOfHeader")}`, value: row => row.quarterlyAsOf },
          { header: `${t("monthlyBonuses")} ${t("finalizedAt")}`, value: row => row.monthlyFinalized },
          { header: `${t("quarterlyBonus")} ${t("finalizedAt")}`, value: row => row.quarterlyFinalized },
        ],
        fileName: `bonus-history-${shopId}${personId ? `-${personId.replace(/[^a-zA-Z0-9_-]/g, "-")}` : ""}`,
        sheetName: t("bonusHistory"),
        format: "csv",
      });
      toast({ title: t("bonusHistoryExported", { count: csvRows.length }) });
    } catch { toast({ variant: "destructive", title: t("bonusHistoryExportFailed") }); }
    finally { setExporting(false); }
  };

  if (!selectedShop) return null;
  return <div className="space-y-4">
    {!detail && <div className="flex flex-wrap items-center justify-end gap-2"><AppSelect aria-label={t("filterPerson")} className="w-auto min-w-40 max-w-full" value={personId} onValueChange={setPersonId} options={[{ value: "", label: t("allPeople") }, ...people.map(([id, name]) => ({ value: id, label: name }))]} /><Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || !rows.length}><Download className="mr-2 h-4 w-4" />{exporting ? t("exportingBonusHistory") : t("exportBonusHistory")}</Button></div>}
      {detail ? <><Link href={`${pathname}?view=history`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" />{t("backToBonusHistory")}</Link><HistoryDetail shopId={shopId} detail={detail} /></> : <>
        <div className="overflow-x-auto rounded-md border bg-card"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50"><tr>{table.getHeaderGroups().map(group => group.headers.map(header => <th key={header.id} className="p-3 text-left font-medium">{flexRender(header.column.columnDef.header, header.getContext())}</th>))}</tr></thead><tbody>{table.getRowModel().rows.map(row => <tr key={row.original.month} className="border-t">{row.getVisibleCells().map(cell => <td key={cell.id} className="p-3 align-top tabular-nums">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table>{history.isPending && <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>}{history.isError && <p className="p-6 text-sm text-destructive">{t("tryAgain")}</p>}{history.isSuccess && !rows.length && <p className="p-6 text-sm text-muted-foreground">{t("noBonusHistory")}</p>}{history.isSuccess && !!rows.length && !visibleRows.length && <p className="p-6 text-sm text-muted-foreground">{t("noPersonBonusHistory")}</p>}</div>
        {history.hasNextPage && <Button variant="outline" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>{history.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{t("loadOlderBonuses")}</Button>}
      </>}
  </div>;
}

function HistoryDetail({ shopId, detail }: { shopId: string; detail: Detail }) {
  const t = useTranslations("DetailedDashboard");
  const locale = useLocale();
  const monthly = useQuery({ queryKey: bonusSnapshotQueryKey(shopId, detail.period), queryFn: () => fetchBonusSnapshot(shopId, detail.period), enabled: detail.kind === "monthly" });
  const quarterly = useQuery({ queryKey: quarterlyBonusSnapshotQueryKey(shopId, detail.period), queryFn: () => fetchQuarterlyBonusSnapshot(shopId, detail.period), enabled: detail.kind === "quarterly" });
  const query = detail.kind === "monthly" ? monthly : quarterly;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "ALL", useGrouping: false, maximumFractionDigits: 0 });
  if (query.isPending) return <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>;
  if (query.isError || !query.data) return <p className="text-sm text-destructive">{t("tryAgain")}</p>;
  if (detail.kind === "monthly") {
    const snapshot = monthly.data;
    if (!snapshot) return null;
    return <div className="space-y-4"><div><h2 className="text-2xl font-semibold">{formatReportingMonth(snapshot.month, locale)}</h2><p className="text-sm text-muted-foreground">{t("finalizedAt")}: {new Date(snapshot.finalizedAt).toLocaleString(locale)}</p></div><ManagerBonusCard result={snapshot.manager} metricSettings={snapshot.inputs.metricSettings} /><RepresentativeBonusCards representatives={snapshot.representatives.map(person => ({ id: person.id, name: person.name }))} results={Object.fromEntries(snapshot.representatives.map(person => [person.id, person.result]))} metricSettings={snapshot.inputs.metricSettings} /></div>;
  }
  const snapshot = quarterly.data;
  if (!snapshot) return null;
  return <div className="space-y-4"><div><h2 className="text-2xl font-semibold">{snapshot.quarter} · {formatReportingMonth(quarterlyPayoutMonth(snapshot.quarter), locale)}</h2><p className="text-sm text-muted-foreground">{t("finalizedAt")}: {new Date(snapshot.finalizedAt).toLocaleString(locale)}</p></div>
    <section className="rounded-md border bg-card p-4"><h3 className="mb-3 font-semibold">{t("monthlyInputs")}</h3><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">{t("monthly")}</th><th className="p-2 text-right">{t("shopPerformance")}</th><th className="p-2 text-right">{t("collection")}</th></tr></thead><tbody>{snapshot.result.shopMonths.map(month => <tr key={month.month} className="border-b last:border-0"><td className="p-2">{formatReportingMonth(month.month, locale)}</td><td className="p-2 text-right">{month.performance.toFixed(1)}%</td><td className="p-2 text-right">{money.format(month.collection)}</td></tr>)}</tbody></table></div></section>
    <section className="rounded-md border bg-card p-4"><h3 className="font-semibold">{t("managerQuarterlyBonus")}</h3><p className="mt-2 text-sm">{t("averagePerformance")}: {snapshot.result.shopAverage.toFixed(1)}% · {t("averageCollection")}: {money.format(snapshot.result.averageCollection)} · {t("eligibility")}: {snapshot.result.manager.eligible ? t("eligible") : t("ineligible")}</p><p className="mt-1 text-sm">{t("collectionGroup")}: {snapshot.result.manager.groupName} · {money.format(snapshot.result.manager.baseBonus)} · {t("payoutRate")}: {snapshot.result.manager.shopRate.toFixed(1)}%</p><p className="mt-2 text-lg font-semibold">{money.format(snapshot.result.manager.totalBonus)}</p></section>
    <section className="rounded-md border bg-card p-4"><h3 className="mb-3 font-semibold">{t("representativeQuarterlyBonus")}</h3><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">{t("representative")}</th>{snapshot.result.months.map(month => <th key={month} className="p-2 text-right">{formatReportingMonth(month, locale)}</th>)}<th className="p-2 text-right">{t("averagePerformance")}</th><th className="p-2 text-right">{t("eligibility")}</th><th className="p-2 text-right">{t("quarterlyBonus")}</th></tr></thead><tbody>{snapshot.result.representatives.map(person => <tr key={person.id} className="border-b last:border-0"><td className="p-2">{person.name}</td>{person.monthly.map(month => <td key={month.month} className="p-2 text-right">{month.performance === null ? "—" : `${month.performance.toFixed(1)}%`}</td>)}<td className="p-2 text-right">{person.individualAverage === null ? "—" : `${person.individualAverage.toFixed(1)}%`}</td><td className="p-2 text-right">{person.eligible ? t("eligible") : t("ineligible")}</td><td className="p-2 text-right font-medium">{money.format(person.totalBonus)}</td></tr>)}</tbody></table></div><p className="mt-3 text-right font-semibold">{t("quarterTotal")}: {money.format(snapshot.result.totalBonus)}</p></section>
  </div>;
}
